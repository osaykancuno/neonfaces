// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Block entropy that works on Arbitrum Orbit chains (Robinhood Chain) and elsewhere.
/// @dev On Arbitrum `block.prevrandao` is constant, `block.number` is an L1 approximation and
/// `blockhash` is documented as "cryptographically insecure". The ArbSys precompile (0x64) exposes
/// the real L2 block number and hashes. ArbSys is used only when BOTH calls work (probed each time);
/// otherwise (local nodes, forks with partial precompile emulation) we fall back to the native
/// opcodes, so block numbers and hashes always come from the same source.
/// Every precompile call is gas-capped: an emulated precompile hitting INVALID can't burn the tx gas.
/// This is NOT a VRF: the sequencer could in theory bias it. It is used only for low-stakes draws
/// (seed tier order, reveal offset) where that trade-off is acceptable and documented.
library ChainEntropy {
    address internal constant ARBSYS = address(100);
    uint256 private constant PRECOMPILE_GAS = 30_000;

    function _call(bytes memory data) private view returns (bool ok, uint256 value) {
        if (ARBSYS.code.length == 0) return (false, 0);
        (bool success, bytes memory ret) = ARBSYS.staticcall{gas: PRECOMPILE_GAS}(data);
        if (!success || ret.length != 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    /// @dev (useArb, arbBlockNumber)
    function _arb() private view returns (bool, uint256) {
        (bool ok, uint256 n) = _call(abi.encodeWithSignature("arbBlockNumber()"));
        if (!ok || n == 0) return (false, 0);
        (bool ok2, uint256 h) = _call(abi.encodeWithSignature("arbBlockHash(uint256)", n - 1));
        if (!ok2 || h == 0) return (false, 0);
        return (true, n);
    }

    /// @notice Current block number (L2 number on Arbitrum chains).
    function blockNumber() internal view returns (uint256) {
        (bool arb, uint256 n) = _arb();
        return arb ? n : block.number;
    }

    /// @notice Hash of block `n` (zero if unavailable / outside the 256-block window).
    function blockHash(uint256 n) internal view returns (bytes32) {
        (bool arb,) = _arb();
        if (arb) {
            (bool ok, uint256 h) = _call(abi.encodeWithSignature("arbBlockHash(uint256)", n));
            return ok ? bytes32(h) : bytes32(0);
        }
        return blockhash(n);
    }

    /// @notice Hash of the previous block.
    function previousBlockHash() internal view returns (bytes32) {
        uint256 n = blockNumber();
        return n == 0 ? bytes32(0) : blockHash(n - 1);
    }
}
