// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ISwapRouter02} from "../../src/NeonTrader.sol";

/// @notice Chainlink-style feed with a settable answer (8 decimals).
contract MockFeed {
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 answer_) {
        set(answer_);
    }

    function set(int256 answer_) public {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice SwapRouter02 stand-in: pays out at the feeds' price minus `haircutBps`, to the recipient.
contract MockV3Router {
    mapping(address token => MockFeed) public feedOf;
    uint256 public haircutBps;

    function setFeed(address token, MockFeed feed) external {
        feedOf[token] = feed;
    }

    function setHaircut(uint256 bps) external {
        haircutBps = bps;
    }

    function exactInput(ISwapRouter02.ExactInputParams calldata p) external payable returns (uint256 out) {
        address tokenIn = address(bytes20(p.path[0:20]));
        address tokenOut = address(bytes20(p.path[p.path.length - 20:]));
        if (msg.value == 0) IERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        uint256 usd = p.amountIn * uint256(feedOf[tokenIn].answer()) / 10 ** _dec(tokenIn);
        out = usd * 10 ** _dec(tokenOut) / uint256(feedOf[tokenOut].answer()) * (10_000 - haircutBps) / 10_000;
        require(out >= p.amountOutMinimum, "Too little received");
        IERC20(tokenOut).transfer(p.recipient, out);
    }

    function _dec(address t) internal view returns (uint256) {
        try IERC20Metadata(t).decimals() returns (uint8 d) {
            return d;
        } catch {
            return 18;
        }
    }
}
