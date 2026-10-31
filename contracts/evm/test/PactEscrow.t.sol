// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PactEscrow, PactEscrowCore} from "../src/PactEscrow.sol";
import {PactFactory} from "../src/PactFactory.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function expectRevert() external;
    function etch(address, bytes calldata) external;
    function store(address, bytes32, bytes32) external;
    function load(address, bytes32) external view returns (bytes32);
    function readFile(string calldata) external returns (string memory);
    function parseJsonBytes32(string calldata, string calldata) external returns (bytes32);
}

contract MockUSDC is ERC20 {
    bool public fail;
    bool public tax;
    bool public callback;
    address public target;
    uint8 public returnMode;

    function setReturnMode(uint8 m) external {
        returnMode = m;
    }

    function transfer(address to, uint256 n) public override returns (bool) {
        super.transfer(to, n);
        if (returnMode == 2) {
            assembly {
                return(0, 0)
            }
        }
        return returnMode != 1;
    }

    function transferFrom(address from, address to, uint256 n) public override returns (bool) {
        super.transferFrom(from, to, n);
        if (returnMode == 2) {
            assembly {
                return(0, 0)
            }
        }
        return returnMode != 1;
    }

    constructor() ERC20("LOCAL ONLY", "TEST") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address a, uint256 n) external {
        _mint(a, n);
    }

    function modes(bool f, bool t, bool c, address e) external {
        fail = f;
        tax = t;
        callback = c;
        target = e;
    }

    function _update(address f, address t, uint256 n) internal override {
        if (f != address(0)) {
            require(!fail, "paused_or_blacklisted");
            if (callback) {
                (bool ok,) = target.call(abi.encodeCall(PactEscrowCore.settleFallback, ()));
                require(ok, "reentry_rejected");
            }
            if (tax && n > 0) {
                super._update(f, address(0), 1);
                n--;
            }
        }
        super._update(f, t, n);
    }
}

contract Wallet1271 {
    address public owner;
    bool public invalid;

    constructor(address o) {
        owner = o;
    }

    function setOwner(address o) external {
        owner = o;
    } // deliberately mutable adversarial fixture

    function setInvalid(bool b) external {
        invalid = b;
    }

    function isValidSignature(bytes32 hash, bytes memory sig) external view returns (bytes4) {
        return !invalid && ECDSA.recover(hash, sig) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract LocalFactory is PactFactory {
    function _identity(address) internal view override {
        require(block.chainid == 31337, "local_only");
    }
}

contract CloneEscrowCandidate is PactEscrowCore {
    constructor() {
        initialized = true;
    } // implementation itself cannot initialize/fund

    function initialize(Terms memory t, address[] memory signers) external {
        _initialize(t, signers);
    }
}

contract LocalCloneFactory {
    address public immutable implementation;

    constructor() {
        implementation = address(new CloneEscrowCandidate());
    }

    function create(PactEscrowCore.Terms memory t, address[] memory signers) external returns (PactEscrow e) {
        require(block.chainid == 31337, "local_only");
        address instance = Clones.clone(implementation);
        CloneEscrowCandidate(instance).initialize(t, signers);
        return PactEscrow(instance);
    }
}

contract PactEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC token;
    PactEscrow escrow;
    PactEscrowCore.Terms t;
    address client;
    address worker;
    address treasury = address(0x123456);
    address[] signers;
    uint256 constant EXPIRY = 150;

    event GasBenchmark(string name, uint256 gasUsed);

    function setUp() public virtual {
        vm.chainId(31337);
        vm.warp(100);
        client = vm.addr(11);
        worker = vm.addr(22);
        token = new MockUSDC();
        address a = vm.addr(33);
        address b = vm.addr(44);
        signers.push(a < b ? a : b);
        signers.push(a < b ? b : a);
        t = PactEscrowCore.Terms(
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(uint256(3)),
            bytes32(uint256(4)),
            bytes32(uint256(5)),
            address(token),
            client,
            worker,
            treasury,
            1000001,
            1000,
            333,
            bytes32(uint256(6)),
            370001,
            200,
            300,
            2
        );
        escrow = new PactEscrow(t, signers);
        token.mint(client, 1100001);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
    }

    function sig(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function fund() internal {
        bytes32 d = escrow.fundingDigest(EXPIRY);
        escrow.fund(EXPIRY, sig(11, d), sig(22, d));
    }

    function mutual(uint256 w) internal {
        bytes32 d = escrow.settlementDigest(false, w, 299);
        escrow.settleMutual(w, 299, sig(11, d), sig(22, d));
    }

    function dispute() internal {
        escrow.invokeDispute(client, 299, sig(11, escrow.disputeDigest(299)));
    }

    function arb(uint256 w) internal {
        bytes32 d = escrow.settlementDigest(true, w, 299);
        bytes[] memory ss = new bytes[](2);
        ss[0] = sig(signers[0] == vm.addr(33) ? 33 : 44, d);
        ss[1] = sig(signers[1] == vm.addr(33) ? 33 : 44, d);
        escrow.settleArbitral(w, 299, ss);
    }

    function testMissingChangedWrongAndReorderedConsent() public {
        bytes32 d = escrow.fundingDigest(EXPIRY);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        vm.expectRevert();
        escrow.fund(EXPIRY, c, "");
        vm.expectRevert();
        escrow.fund(EXPIRY, w, c);
        vm.expectRevert();
        escrow.fund(EXPIRY + 1, c, w);
        t.treasury = address(0x56789);
        PactEscrow other = new PactEscrow(t, signers);
        vm.expectRevert();
        other.fund(EXPIRY, c, w);
        require(token.balanceOf(client) == 1100001 && uint256(escrow.state()) == 0);
    }

    function testChainAndInstanceReplay() public {
        bytes32 d = escrow.fundingDigest(EXPIRY);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        PactEscrow other = new PactEscrow(t, signers);
        vm.expectRevert();
        other.fund(EXPIRY, c, w);
        vm.chainId(84532);
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
    }

    function testFundingExpiryAndDuplicate() public {
        vm.warp(EXPIRY);
        bytes32 d = escrow.fundingDigest(EXPIRY);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
        vm.warp(100);
        fund();
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
    }

    function testFundingPauseTaxAndReentryRollback() public {
        bytes32 d = escrow.fundingDigest(EXPIRY);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        token.modes(true, false, false, address(escrow));
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
        token.modes(false, true, false, address(escrow));
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
        token.modes(false, false, true, address(escrow));
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
        require(uint256(escrow.state()) == 0 && token.balanceOf(address(escrow)) == 0);
    }

    function testRefundReturnsAllReserve() public {
        fund();
        mutual(0);
        require(token.balanceOf(client) == 1100001 && token.balanceOf(treasury) == 0);
    }

    function testFullPayment() public {
        fund();
        mutual(t.principal);
        require(token.balanceOf(worker) == 966701 && token.balanceOf(treasury) == 133300);
    }

    function testSplitDonationAndReplay() public {
        fund();
        token.mint(address(escrow), 7);
        mutual(370001);
        require(
            token.balanceOf(client) == 693000 && token.balanceOf(worker) == 357680 && token.balanceOf(treasury) == 49321
        );
        require(token.balanceOf(address(escrow)) == 7);
        bytes32 d = escrow.settlementDigest(false, 0, 299);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        vm.expectRevert();
        escrow.settleMutual(0, 299, c, w);
        vm.warp(300);
        vm.expectRevert();
        escrow.settleFallback();
    }

    function testDisputeBoundariesAndThreshold() public {
        fund();
        vm.warp(199);
        dispute();
        bytes[] memory bad = new bytes[](1);
        bad[0] = sig(33, escrow.settlementDigest(true, 0, 299));
        vm.expectRevert();
        escrow.settleArbitral(0, 299, bad);
        bad = new bytes[](2);
        bad[0] = sig(33, escrow.settlementDigest(true, 0, 299));
        bad[1] = bad[0];
        vm.expectRevert();
        escrow.settleArbitral(0, 299, bad);
        vm.warp(200);
        arb(370001);
        require(uint256(escrow.state()) == 3);
    }

    function testDisputeAtDAndFallbackAtT() public {
        fund();
        vm.warp(200);
        bytes memory s = sig(11, escrow.disputeDigest(299));
        vm.expectRevert();
        escrow.invokeDispute(client, 299, s);
        vm.warp(299);
        vm.expectRevert();
        escrow.settleFallback();
        vm.warp(300);
        escrow.settleFallback();
        require(uint256(escrow.state()) == 3);
    }

    function testMutualAndArbAtTFailFallbackSucceeds() public {
        fund();
        dispute();
        bytes32 d = escrow.settlementDigest(false, 0, 400);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        bytes[] memory ss = new bytes[](2);
        d = escrow.settlementDigest(true, 0, 400);
        ss[0] = sig(33, d);
        ss[1] = sig(44, d);
        vm.warp(300);
        vm.expectRevert();
        escrow.settleMutual(0, 400, c, w);
        vm.expectRevert();
        escrow.settleArbitral(0, 400, ss);
        escrow.settleFallback();
    }

    function testOutboundFailureAtomicAndRetry() public {
        fund();
        vm.warp(300);
        token.modes(true, false, false, address(escrow));
        vm.expectRevert();
        escrow.settleFallback();
        require(uint256(escrow.state()) == 1 && token.balanceOf(address(escrow)) == 1100001);
        token.modes(false, true, false, address(escrow));
        vm.expectRevert();
        escrow.settleFallback();
        token.modes(false, false, true, address(escrow));
        vm.expectRevert();
        escrow.settleFallback();
        token.modes(false, false, false, address(escrow));
        escrow.settleFallback();
    }

    function testContractWalletConsentAndMutation() public {
        Wallet1271 wallet = new Wallet1271(worker);
        t.worker = address(wallet);
        escrow = new PactEscrow(t, signers);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
        fund();
        bytes32 d = escrow.settlementDigest(false, 370001, 299);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        wallet.setOwner(vm.addr(55));
        vm.expectRevert();
        escrow.settleMutual(370001, 299, c, w);
        wallet.setOwner(worker);
        escrow.settleMutual(370001, 299, c, w);
    }

    function testDisabledArbitrationAndMutableArbiterRejected() public {
        address[] memory empty = new address[](0);
        t.threshold = 0;
        escrow = new PactEscrow(t, empty);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
        fund();
        bytes memory s = sig(11, escrow.disputeDigest(299));
        vm.expectRevert();
        escrow.invokeDispute(client, 299, s);
        t.threshold = 1;
        address[] memory a = new address[](1);
        a[0] = address(new Wallet1271(worker));
        vm.expectRevert();
        new PactEscrow(t, a);
    }

    function testFactoryWrongIdentityAndNativeEther() public {
        PactFactory f = new PactFactory();
        vm.expectRevert();
        f.create(t, signers);
        (bool ok,) = address(escrow).call("");
        require(!ok);
        LocalFactory local = new LocalFactory();
        PactEscrow e = local.create(t, signers);
        require(e.termsHash() == escrow.termsHash());
    }

    function testFuzzConservation(uint256 p, uint256 w, uint16 bc, uint16 bw) public {
        p = p % (type(uint256).max / 2) + 1;
        w = w % p;
        bc = bc % 1001;
        bw = bw % 1001;
        t.principal = p;
        t.clientBps = bc;
        t.workerBps = bw;
        t.fallbackWorker = w;
        PactEscrow e = new PactEscrow(t, signers);
        (uint256 c, uint256 workerNet, uint256 fee) = e.allocation(w);
        // Independent quotient/remainder oracle avoids overflowing p*rate.
        uint256 r = (p / 10000) * bc + (p % 10000) * bc / 10000;
        uint256 fc = (w / 10000) * bc + (w % 10000) * bc / 10000;
        uint256 fw = (w / 10000) * bw + (w % 10000) * bw / 10000;
        require(c == p - w + r - fc && workerNet == w - fw && fee == fc + fw && c + workerNet + fee == p + r);
    }

    function testFuzzTerminalConservation(uint64 principal, uint64 workerShare, uint16 bc, uint16 bw, bool fallbackPath)
        public
    {
        t.principal = uint256(principal) + 1;
        t.clientBps = bc % 1001;
        t.workerBps = bw % 1001;
        uint256 w = uint256(workerShare) % t.principal;
        t.fallbackWorker = w;
        escrow = new PactEscrow(t, signers);
        token.mint(client, t.principal + escrow.reserve());
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
        uint256 before = token.balanceOf(client);
        fund();
        if (fallbackPath) {
            vm.warp(300);
            escrow.settleFallback();
        } else {
            mutual(w);
        }
        require(token.balanceOf(client) + token.balanceOf(worker) + token.balanceOf(treasury) == before);
        require(token.balanceOf(address(escrow)) == 0 && uint256(escrow.state()) == 3);
        vm.warp(300);
        vm.expectRevert();
        escrow.settleFallback();
    }

    function testMaxOverflowAndInvalidTerms() public {
        t.principal = type(uint256).max;
        vm.expectRevert();
        new PactEscrow(t, signers);
        t.clientBps = 0;
        PactEscrow e = new PactEscrow(t, signers);
        (uint256 c, uint256 w, uint256 f) = e.allocation(t.principal);
        require(c + w + f == t.principal);
        t.workerBps = 1001;
        vm.expectRevert();
        new PactEscrow(t, signers);
    }

    function testAllFourFeeModesAtSplit() public {
        for (uint256 mode; mode < 4; mode++) {
            t.clientBps = mode % 2 == 1 ? 1000 : 0;
            t.workerBps = mode >= 2 ? 1000 : 0;
            escrow = new PactEscrow(t, signers);
            token.mint(client, t.principal + escrow.reserve());
            vm.prank(client);
            token.approve(address(escrow), type(uint256).max);
            uint256 beforeClient = token.balanceOf(client);
            uint256 beforeWorker = token.balanceOf(worker);
            uint256 beforeTreasury = token.balanceOf(treasury);
            fund();
            mutual(37);
            uint256 fc = 37 * t.clientBps / 10000;
            uint256 fw = 37 * t.workerBps / 10000;
            require(token.balanceOf(client) == beforeClient - 37 - fc);
            require(token.balanceOf(worker) == beforeWorker + 37 - fw);
            require(token.balanceOf(treasury) == beforeTreasury + fc + fw);
        }
    }

    function testNonstandardTokenReturns() public {
        bytes32 d = escrow.fundingDigest(EXPIRY);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        token.setReturnMode(1);
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
        require(uint256(escrow.state()) == 0 && token.balanceOf(client) == 1100001);
        token.setReturnMode(2);
        fund();
        mutual(370001);
        require(uint256(escrow.state()) == 3);
    }

    function testUnderAllowanceAndWrongArbiterIntent() public {
        vm.prank(client);
        token.approve(address(escrow), 1100000);
        bytes32 d = escrow.fundingDigest(EXPIRY);
        bytes memory c = sig(11, d);
        bytes memory w = sig(22, d);
        vm.expectRevert();
        escrow.fund(EXPIRY, c, w);
        vm.prank(client);
        token.approve(address(escrow), 1100001);
        fund();
        dispute();
        bytes[] memory ss = new bytes[](2);
        d = escrow.settlementDigest(false, 0, 299);
        ss[0] = sig(signers[0] == vm.addr(33) ? 33 : 44, d);
        ss[1] = sig(signers[1] == vm.addr(33) ? 33 : 44, d);
        vm.expectRevert();
        escrow.settleArbitral(0, 299, ss);
        vm.etch(signers[0], hex"60006000");
        d = escrow.settlementDigest(true, 0, 299);
        ss[0] = sig(signers[0] == vm.addr(33) ? 33 : 44, d);
        ss[1] = sig(signers[1] == vm.addr(33) ? 33 : 44, d);
        vm.expectRevert();
        escrow.settleArbitral(0, 299, ss);
        vm.warp(300);
        escrow.settleFallback();
    }

    function testCanonicalTypeScriptVectors() public {
        string memory json = vm.readFile("test/vectors.json");
        address fixedToken = address(0x111);
        vm.etch(fixedToken, address(token).code);
        t.token = fixedToken;
        t.client = address(0x22);
        t.worker = address(0x33);
        t.treasury = address(0x44);
        address[] memory a = new address[](2);
        a[0] = address(0x55);
        a[1] = address(0x66);
        PactEscrow e = new PactEscrow(t, a);
        address instance = address(0x999);
        vm.etch(instance, address(e).code);
        // Copy candidate storage to the synthetic vector address (in-memory EVM only).
        // Enumerate via vm.load so layouts remain checked by actual digest results.
        for (uint256 i; i < 32; i++) {
            vm.store(instance, bytes32(i), vm.load(address(e), bytes32(i)));
        }
        require(e.termsHash() == vm.parseJsonBytes32(json, ".termsHash"));
        require(PactEscrow(instance).fundingDigest(150) == vm.parseJsonBytes32(json, ".funding"));
        require(PactEscrow(instance).disputeDigest(150) == vm.parseJsonBytes32(json, ".dispute"));
        // Settlement helpers read principal; use the same ABI/type independently at the fixed domain.
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PactAgentEscrow"),
                keccak256("2-local-review-1"),
                uint256(31337),
                instance
            )
        );
        bytes32 m = keccak256(
            abi.encode(e.MUTUAL_TYPEHASH(), e.termsHash(), uint256(370001), uint256(630000), uint256(0), uint256(150))
        );
        bytes32 ar = keccak256(
            abi.encode(e.ARBITRAL_TYPEHASH(), e.termsHash(), uint256(370001), uint256(630000), uint256(0), uint256(150))
        );
        require(keccak256(abi.encodePacked(hex"1901", domain, m)) == vm.parseJsonBytes32(json, ".mutual"));
        require(keccak256(abi.encodePacked(hex"1901", domain, ar)) == vm.parseJsonBytes32(json, ".arbitration"));
    }

    function testBenchmarkFullAndEquivalentPinnedClone() public {
        uint256 before = gasleft();
        PactEscrow full = new PactEscrow(t, signers);
        emit GasBenchmark("full", before - gasleft());
        LocalCloneFactory factory = new LocalCloneFactory();
        before = gasleft();
        PactEscrow clone = factory.create(t, signers);
        emit GasBenchmark("clone_with_same_terms_and_logic", before - gasleft());
        require(clone.termsHash() == full.termsHash());
        vm.expectRevert();
        CloneEscrowCandidate(address(clone)).initialize(t, signers);
        address implementation = factory.implementation();
        vm.expectRevert();
        CloneEscrowCandidate(implementation).initialize(t, signers);
        escrow = clone;
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
        fund();
        mutual(370001);
        require(uint256(escrow.state()) == 3);
    }
}

contract TerminalHandler {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    PactEscrow public escrow;
    uint256 public successes;

    constructor(PactEscrow e) {
        escrow = e;
    }

    function attempt(uint256 workerAmount, bool fallbackPath) external {
        if (fallbackPath) {
            vm.warp(300);
            try escrow.settleFallback() {
                successes++;
            } catch {}
        } else {
            workerAmount %= 1000002;
            bytes32 d = escrow.settlementDigest(false, workerAmount, 299);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(11, d);
            bytes memory c = abi.encodePacked(r, s, v);
            (v, r, s) = vm.sign(22, d);
            bytes memory w = abi.encodePacked(r, s, v);
            try escrow.settleMutual(workerAmount, 299, c, w) {
                successes++;
            } catch {}
        }
    }
}

contract TerminalInvariantTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC token;
    PactEscrow escrow;
    address client;
    address worker;
    address treasury = address(0x123456);
    TerminalHandler handler;

    function setUp() public virtual {
        vm.chainId(31337);
        vm.warp(100);
        client = vm.addr(11);
        worker = vm.addr(22);
        token = new MockUSDC();
        PactEscrowCore.Terms memory t = PactEscrowCore.Terms(
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(uint256(3)),
            bytes32(uint256(4)),
            bytes32(uint256(5)),
            address(token),
            client,
            worker,
            treasury,
            1000001,
            1000,
            333,
            bytes32(uint256(6)),
            370001,
            200,
            300,
            0
        );
        escrow = new PactEscrow(t, new address[](0));
        token.mint(client, 1100001);
        vm.prank(client);
        token.approve(address(escrow), 1100001);
        bytes32 d = escrow.fundingDigest(150);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(11, d);
        bytes memory c = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(22, d);
        escrow.fund(150, c, abi.encodePacked(r, s, v));
        handler = new TerminalHandler(escrow);
    }

    function targetContracts() external view returns (address[] memory a) {
        a = new address[](1);
        a[0] = address(handler);
    }

    function invariant_noDoubleSettlementAndConservation() public view {
        require(handler.successes() <= 1);
        require(
            token.balanceOf(client) + token.balanceOf(worker) + token.balanceOf(treasury)
                + token.balanceOf(address(escrow)) == 1100001
        );
        if (handler.successes() == 1) require(uint256(escrow.state()) == 3 && token.balanceOf(address(escrow)) == 0);
    }
}

contract PactEscrowCloneTest is PactEscrowTest {
    function setUp() public override {
        super.setUp();
        LocalCloneFactory factory = new LocalCloneFactory();
        escrow = factory.create(t, signers);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
    }
}

contract TerminalCloneInvariantTest is TerminalInvariantTest {
    function setUp() public override {
        super.setUp();
        LocalCloneFactory factory = new LocalCloneFactory();
        escrow = factory.create(escrow.terms(), new address[](0));
        token.mint(client, 1100001);
        vm.prank(client);
        token.approve(address(escrow), 1100001);
        bytes32 d = escrow.fundingDigest(150);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(11, d);
        bytes memory c = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(22, d);
        escrow.fund(150, c, abi.encodePacked(r, s, v));
        handler = new TerminalHandler(escrow);
    }
}
