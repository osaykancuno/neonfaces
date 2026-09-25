// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockStockToken} from "./MockStockToken.sol";

/// @notice Stands in for NeonTrader in unit tests: pays `rate` units of path[last] per wei, to the caller.
contract MockSeedTrader {
    address public immutable weth;
    uint256 public rate = 1;
    mapping(address => uint256) public dailyLimit;

    constructor(address weth_) {
        weth = weth_;
    }

    function setDailyLimit(uint256 usd8) external {
        dailyLimit[msg.sender] = usd8;
    }

    function swap(address[] calldata path, uint24[] calldata, uint256 amountIn, uint256)
        external
        payable
        returns (uint256 amountOut)
    {
        require(msg.value == amountIn && path[0] == weth, "pay with ETH");
        amountOut = amountIn * rate;
        MockStockToken(path[path.length - 1]).mint(msg.sender, amountOut);
    }
}
