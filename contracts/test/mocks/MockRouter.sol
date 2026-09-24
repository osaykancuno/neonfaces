// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal "strategy target" used to test agent delegation (1:1 swaps, ETH purchases).
contract MockRouter {
    uint256 public pings;

    function ping() external {
        pings++;
    }

    /// pulls `amount` of tokenIn from the caller (needs allowance) and pays `amount` of tokenOut
    function swap(address tokenIn, address tokenOut, uint256 amount) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
        IERC20(tokenOut).transfer(msg.sender, amount);
    }

    /// pays `msg.value` units of tokenOut for the ETH sent
    function buyWithETH(address tokenOut) external payable {
        IERC20(tokenOut).transfer(msg.sender, msg.value);
    }
}

/// @notice A contract wallet (think Safe) holding a Face: proves smart-wallet holders get full control.
contract MiniSmartWallet {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function exec(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "not owner");
        (bool ok, bytes memory r) = target.call{value: value}(data);
        require(ok, "call failed");
        return r;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
