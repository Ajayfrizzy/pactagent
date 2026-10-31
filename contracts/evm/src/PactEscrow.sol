// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice LOCAL REVIEW CANDIDATE. ABI is not frozen. No deployment is authorized.
/// @dev Storage is constructor-only except lifecycle state. No initializer/admin/delegatecall.
abstract contract PactEscrowCore is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Terms {
        bytes32 appId;
        bytes32 agreementId;
        bytes32 milestoneId;
        bytes32 escrowId;
        bytes32 applicationCommitment;
        address token;
        address client;
        address worker;
        address treasury;
        uint256 principal;
        uint256 clientBps;
        uint256 workerBps;
        bytes32 feePolicy;
        uint256 fallbackWorker;
        uint256 disputeDeadline;
        uint256 finalDeadline;
        uint256 threshold;
    }

    enum State {
        Unfunded,
        Funded,
        Disputed,
        Terminal
    }

    Terms private _terms;
    address[] private _arbiters;
    bytes32 public termsHash;
    uint256 public reserve;
    uint256 public deploymentChainId;
    bool internal initialized;
    State public state;
    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "Terms(bytes32 appId,bytes32 agreementId,bytes32 milestoneId,bytes32 escrowId,bytes32 applicationCommitment,address token,address client,address worker,address treasury,uint256 principal,uint256 clientBps,uint256 workerBps,bytes32 feePolicy,uint256 fallbackWorker,uint256 disputeDeadline,uint256 finalDeadline,uint256 threshold,bytes32 arbiterSetHash)"
    );
    bytes32 public constant FUND_TYPEHASH =
        keccak256("FundingApproval(bytes32 termsHash,uint256 nonce,uint256 validUntil)");
    bytes32 public constant MUTUAL_TYPEHASH = keccak256(
        "MutualSettlement(bytes32 termsHash,uint256 workerAmount,uint256 clientAmount,uint256 nonce,uint256 validUntil)"
    );
    bytes32 public constant DISPUTE_TYPEHASH =
        keccak256("DisputeInvocation(bytes32 termsHash,uint256 nonce,uint256 validUntil)");
    bytes32 public constant ARBITRAL_TYPEHASH = keccak256(
        "ArbitralSettlement(bytes32 termsHash,uint256 workerAmount,uint256 clientAmount,uint256 nonce,uint256 validUntil)"
    );

    error InvalidTerms();
    error Unauthorized();
    error InvalidState();
    error InvalidTime();
    error InexactTransfer();

    event Funded(bytes32 indexed escrowId, bytes32 indexed termsHash, uint256 deposit);
    event DisputeInvoked(bytes32 indexed escrowId, address indexed participant);
    event Settled(
        bytes32 indexed escrowId,
        bytes32 indexed termsHash,
        uint8 indexed path,
        uint256 workerPrincipal,
        uint256 clientPrincipal,
        uint256 workerNet,
        uint256 clientNet,
        uint256 treasuryNet
    );

    constructor() EIP712("PactAgentEscrow", "2-local-review-1") {}
    // Full instances call this only in their constructor. A test-only clone
    // candidate exposes an atomic factory initializer; each instance is write-once.

    function _initialize(Terms memory t, address[] memory signers) internal {
        if (initialized) revert InvalidState();
        initialized = true;
        if (
            t.token.code.length == 0 || IERC20Metadata(t.token).decimals() != 6 || t.client == address(0)
                || t.worker == address(0) || t.treasury == address(0) || t.client == t.worker || t.client == t.treasury
                || t.worker == t.treasury || t.client == address(this) || t.worker == address(this)
                || t.treasury == address(this) || t.client == t.token || t.worker == t.token || t.treasury == t.token
                || t.principal == 0 || t.clientBps > 1000 || t.workerBps > 1000 || t.fallbackWorker > t.principal
                || t.disputeDeadline <= block.timestamp || t.disputeDeadline >= t.finalDeadline || signers.length > 16
                || (signers.length == 0 ? t.threshold != 0 : t.threshold == 0 || t.threshold > signers.length)
        ) revert InvalidTerms();
        for (uint256 i; i < signers.length; ++i) {
            if (signers[i] == address(0) || signers[i].code.length != 0 || (i != 0 && signers[i] <= signers[i - 1])) {
                revert InvalidTerms();
            }
        }
        reserve = Math.mulDiv(t.principal, t.clientBps, 10000);
        if (t.principal > type(uint256).max - reserve) revert InvalidTerms();
        _terms = t;
        _arbiters = signers;
        deploymentChainId = block.chainid;
        termsHash = keccak256(abi.encode(TERMS_TYPEHASH, t, keccak256(abi.encode(signers))));
    }

    function terms() external view returns (Terms memory) {
        return _terms;
    }

    function arbiters() external view returns (address[] memory) {
        return _arbiters;
    }
    // Each action can occur at most once; nonce is explicitly fixed to zero by the codec.
    // State transitions consume that action without a mutable shared nonce invalidating others.

    function fundingDigest(uint256 expiry) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(FUND_TYPEHASH, termsHash, uint256(0), expiry)));
    }

    function disputeDigest(uint256 expiry) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(DISPUTE_TYPEHASH, termsHash, uint256(0), expiry)));
    }

    function settlementDigest(bool arbitration, uint256 w, uint256 expiry) public view returns (bytes32) {
        if (w > _terms.principal) revert InvalidTerms();
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    arbitration ? ARBITRAL_TYPEHASH : MUTUAL_TYPEHASH,
                    termsHash,
                    w,
                    _terms.principal - w,
                    uint256(0),
                    expiry
                )
            )
        );
    }

    function _live(uint256 expiry) private view {
        if (block.chainid != deploymentChainId || block.timestamp >= expiry || block.timestamp >= _terms.finalDeadline)
        {
            revert InvalidTime();
        }
    }

    function _both(bytes32 digest, bytes calldata clientSig, bytes calldata workerSig) private view {
        if (
            !SignatureChecker.isValidSignatureNow(_terms.client, digest, clientSig)
                || !SignatureChecker.isValidSignatureNow(_terms.worker, digest, workerSig)
        ) revert Unauthorized();
    }

    function fund(uint256 expiry, bytes calldata clientSig, bytes calldata workerSig) external nonReentrant {
        if (state != State.Unfunded) revert InvalidState();
        _live(expiry);
        // Funding must leave the mutually accepted dispute invocation window available.
        if (expiry > _terms.disputeDeadline || block.timestamp >= _terms.disputeDeadline) revert InvalidTime();
        _both(fundingDigest(expiry), clientSig, workerSig);
        state = State.Funded;
        IERC20 token = IERC20(_terms.token);
        uint256 amount = _terms.principal + reserve;
        uint256 beforeEscrow = token.balanceOf(address(this));
        uint256 beforeClient = token.balanceOf(_terms.client);
        token.safeTransferFrom(_terms.client, address(this), amount);
        if (
            token.balanceOf(address(this)) != beforeEscrow + amount
                || token.balanceOf(_terms.client) != beforeClient - amount
        ) revert InexactTransfer();
        emit Funded(_terms.escrowId, termsHash, amount);
    }

    function invokeDispute(address participant, uint256 expiry, bytes calldata sig) external nonReentrant {
        if (state != State.Funded || _terms.threshold == 0) revert InvalidState();
        _live(expiry);
        if (block.timestamp >= _terms.disputeDeadline) revert InvalidTime();
        if (
            (participant != _terms.client && participant != _terms.worker)
                || !SignatureChecker.isValidSignatureNow(participant, disputeDigest(expiry), sig)
        ) revert Unauthorized();
        state = State.Disputed;
        emit DisputeInvoked(_terms.escrowId, participant);
    }

    function settleMutual(uint256 w, uint256 expiry, bytes calldata clientSig, bytes calldata workerSig)
        external
        nonReentrant
    {
        _live(expiry);
        _both(settlementDigest(false, w, expiry), clientSig, workerSig);
        _settle(w, 0);
    }

    function settleArbitral(uint256 w, uint256 expiry, bytes[] calldata signatures) external nonReentrant {
        if (state != State.Disputed || _terms.threshold == 0 || signatures.length != _terms.threshold) {
            revert InvalidState();
        }
        _live(expiry);
        bytes32 digest = settlementDigest(true, w, expiry);
        address previous;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            // Direct ECDSA only: ERC-1271/delegated code does not supply arbitral authority.
            if (signer <= previous || signer.code.length != 0) revert Unauthorized();
            bool found;
            for (uint256 j; j < _arbiters.length; ++j) {
                if (_arbiters[j] == signer) found = true;
            }
            if (!found) revert Unauthorized();
            previous = signer;
        }
        _settle(w, 1);
    }

    function settleFallback() external nonReentrant {
        if (block.chainid != deploymentChainId || block.timestamp < _terms.finalDeadline) revert InvalidTime();
        _settle(_terms.fallbackWorker, 2);
    }

    function allocation(uint256 w) public view returns (uint256 clientNet, uint256 workerNet, uint256 treasuryNet) {
        if (w > _terms.principal) revert InvalidTerms();
        uint256 fc = Math.mulDiv(w, _terms.clientBps, 10000);
        uint256 fw = Math.mulDiv(w, _terms.workerBps, 10000);
        return (_terms.principal - w + reserve - fc, w - fw, fc + fw);
    }

    function _settle(uint256 w, uint8 path) private {
        if (state != State.Funded && state != State.Disputed) revert InvalidState();
        (uint256 cNet, uint256 wNet, uint256 fee) = allocation(w);
        state = State.Terminal;
        _pay(_terms.client, cNet);
        _pay(_terms.worker, wNet);
        _pay(_terms.treasury, fee);
        emit Settled(_terms.escrowId, termsHash, path, w, _terms.principal - w, wNet, cNet, fee);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        IERC20 token = IERC20(_terms.token);
        uint256 fromBalance = token.balanceOf(address(this));
        uint256 toBalance = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(address(this)) != fromBalance - amount || token.balanceOf(to) != toBalance + amount) {
            revert InexactTransfer();
        }
    }
}

/// @notice Full-deployment candidate: no externally callable initializer.
contract PactEscrow is PactEscrowCore {
    constructor(Terms memory t, address[] memory signers) {
        _initialize(t, signers);
    }
}
