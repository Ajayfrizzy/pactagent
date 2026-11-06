// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PactEscrow} from "./PactEscrow.sol";

/// @notice Provisional full-deployment factory. No owner, initializer or upgrade route.
/// @dev Local harness uses an explicitly separate subclass; no live address is configured.
contract PactFactory {
    address public constant TEST_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    event Created(bytes32 indexed appId, bytes32 indexed escrowId, address indexed escrow, bytes32 termsHash);

    function _identity(address token) internal view virtual {
        require(block.chainid == 84532 && token == TEST_USDC, "unavailable_identity");
    }

    function create(PactEscrow.Terms calldata t, address[] calldata signers) external returns (PactEscrow escrow) {
        _identity(t.token);
        escrow = new PactEscrow(t, signers);
        emit Created(t.appId, t.escrowId, address(escrow), escrow.termsHash());
    }
}
