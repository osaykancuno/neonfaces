// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockStockToken} from "./MockStockToken.sol";

/// @notice Stands in for NeonTrader in unit tests: pays `rate` units of path[last] per wei, to the caller.
contract MockSeedTrader {
    address public immutable weth;
    uint256 public rate = 1;
    mapping(address => uint256) public dailyLimit;
    mapping(address => uint256) public usd8Of; // Chainlink stand-in (8 decimals); 0 = unknown token
    mapping(address => bool) public offPrice; // the pool is more than 1% off its feed: Uniswap refuses the swap

    function setOffPrice(address token, bool off) external {
        offPrice[token] = off;
    }

    function setRate(uint256 r) external {
        rate = r;
    }

    function setPrice(address token, uint256 usd8) external {
        usd8Of[token] = usd8;
    }

    function price(address token) external view returns (uint256) {
        require(usd8Of[token] != 0, "unknown token");
        return usd8Of[token];
    }

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
        require(!offPrice[path[path.length - 1]], "Too little received");
        amountOut = amountIn * rate;
        MockStockToken(path[path.length - 1]).mint(msg.sender, amountOut);
    }
}
