// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal "strategy target" used to test agent delegation: swaps tokenIn for tokenOut 1:1.
contract MockRouter {
    uint256 public pings;

    function ping() external {
        pings++;
    }

    function swap(address tokenIn, address tokenOut, uint256 amount) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
        IERC20(tokenOut).transfer(msg.sender, amount);
    }
}
