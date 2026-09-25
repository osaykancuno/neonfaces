// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Uniswap SwapRouter02 (IV3SwapRouter) — Robinhood Chain 0xcaf681a66d020601342297493863e78c959e5cb2
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev Chainlink AggregatorV3Interface
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title NeonTrader — the only door a Face's agent needs to trade
/// @notice A holder lets their agent call `swap` on this contract (and approves it once). Whatever the agent
/// does, these rules hold, enforced here and not by the agent:
///  - **the output always goes back to the caller** (the Face account) — an agent can't redirect it;
///  - **fair price**: the minimum output is computed from Chainlink feeds, at most `MAX_SLIPPAGE_BPS` worse
///    than the oracle price after pool fees — an agent can't dump the Face's assets or sandwich it;
///  - **known tokens only**: Stock Tokens, USDG and WETH/ETH listed at deployment, each with its feed;
///  - **fresh prices only**: stale feeds (e.g. equities over the weekend) make trades revert;
///  - **daily cap in USD**, set by the account itself (i.e. by the holder through `execute`).
/// The holder can also leave a standing **strategy** here (accumulate a ticker, keep a share liquid, trim a
/// ticker), which agents read; an agent explains each trade with a short on-chain **note** (`swapWithNote`).
/// Neither widens what an agent can do: every trade still passes the rules above.
/// No owner, no upgrade, no fees. Trades run on Uniswap v3 through the official SwapRouter02.
contract NeonTrader is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SLIPPAGE_BPS = 100; // 1% beyond pool fees, vs Chainlink
    uint256 public constant MAX_PRICE_AGE = 26 hours; // feeds heartbeat 24 h (+ margin)
    uint256 public constant MAX_HOPS = 3;
    uint256 private constant USD = 1e8; // prices and limits use 8 decimals

    ISwapRouter02 public immutable router;
    address public immutable weth;

    mapping(address token => address feed) public feedOf;
    address[] internal _tokens;

    mapping(address account => uint256 usd8) public dailyLimit;
    mapping(address account => mapping(uint256 day => uint256 usd8)) public spentOn;

    uint8 public constant ACCUMULATE = 1; // buy `token` with `usd8` of `funding` every `every` seconds
    uint8 public constant KEEP_LIQUID = 2; // keep at least `bps` of the Face's value in `token` (a stablecoin)
    uint8 public constant TRIM = 3; // sell `token` into `funding` when it exceeds `bps` of the Face's value
    // Strategies are instructions, not permissions: moves are checked by the agent that runs them (and every
    // trade still passes the price, token and daily-cap rules below). `every` paces them, the notes explain them.
    uint256 public constant MAX_NOTE = 96;

    /// @notice A standing instruction from the holder, read by agents (the NEONFACES strategy agent runs them).
    struct Strategy {
        uint8 kind; // 0 none
        address token;
        address funding;
        uint16 bps;
        uint32 every; // seconds between moves, at least 1 hour
        uint96 usd8; // ACCUMULATE: USD per move, 8 decimals
    }

    mapping(address account => Strategy) internal _strategies;

    event DailyLimitSet(address indexed account, uint256 usd8);
    event StrategySet(address indexed account, Strategy strategy);
    event Note(address indexed account, string note);
    event Traded(
        address indexed account,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 valueUsd8
    );

    error UnknownToken(address token);
    error BadPath();
    error SlippageTooHigh();
    error StalePrice(address token, uint256 updatedAt);
    error BadPrice(address token);
    error DailyLimitExceeded(uint256 requestedUsd8, uint256 leftUsd8);
    error BadEthAmount();
    error BadStrategy();
    error NoteTooLong();

    constructor(ISwapRouter02 router_, address weth_, address[] memory tokens_, address[] memory feeds_) {
        require(tokens_.length == feeds_.length && tokens_.length > 0, "config");
        router = router_;
        weth = weth_;
        for (uint256 i; i < tokens_.length; ++i) {
            require(tokens_[i] != address(0) && feeds_[i] != address(0) && feedOf[tokens_[i]] == address(0), "config");
            feedOf[tokens_[i]] = feeds_[i];
            _tokens.push(tokens_[i]);
        }
        require(feedOf[weth_] != address(0), "weth feed");
    }

    // ------------------------------------------------------------------
    // Holder setting (called by the Face account through `execute`)
    // ------------------------------------------------------------------

    /// @notice Max USD value (8 decimals) the caller may trade per UTC day. 0 disables trading.
    function setDailyLimit(uint256 usd8) external {
        dailyLimit[msg.sender] = usd8;
        emit DailyLimitSet(msg.sender, usd8);
    }

    /// @notice Set (or clear, with kind 0) the caller's strategy. Tokens must be listed here.
    function setStrategy(Strategy calldata s) external {
        uint8 k = s.kind;
        if (k > TRIM) revert BadStrategy();
        if (k != 0) {
            bool listed = feedOf[s.token] != address(0)
                && (k == KEEP_LIQUID || (feedOf[s.funding] != address(0) && s.token != s.funding));
            bool ok = listed && s.every >= 1 hours
                && (k == ACCUMULATE ? s.usd8 != 0 : s.bps != 0 && s.bps < 10_000);
            if (!ok) revert BadStrategy();
        }
        _strategies[msg.sender] = s;
        emit StrategySet(msg.sender, s);
    }

    function strategyOf(address account) external view returns (Strategy memory) {
        return _strategies[account];
    }

    // ------------------------------------------------------------------
    // Trading
    // ------------------------------------------------------------------

    /// @notice Swap `amountIn` of `path[0]` into `path[last]` through the given v3 pools (`fees[i]` between
    /// `path[i]` and `path[i+1]`). Pay with ETH by sending `msg.value == amountIn` and `path[0] == weth`.
    /// The output is sent to the caller. `slippageBps` ≤ 1%.
    function swap(address[] calldata path, uint24[] calldata fees, uint256 amountIn, uint256 slippageBps)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        amountOut = _swap(path, fees, amountIn, slippageBps);
    }

    /// @notice `swap`, plus a short public note (≤ 96 bytes) saying why, shown in the Face's journal.
    function swapWithNote(
        address[] calldata path,
        uint24[] calldata fees,
        uint256 amountIn,
        uint256 slippageBps,
        string calldata note
    ) external payable nonReentrant returns (uint256 amountOut) {
        if (bytes(note).length > MAX_NOTE) revert NoteTooLong();
        amountOut = _swap(path, fees, amountIn, slippageBps);
        emit Note(msg.sender, note);
    }

    function _swap(address[] calldata path, uint24[] calldata fees, uint256 amountIn, uint256 slippageBps)
        internal
        returns (uint256 amountOut)
    {
        (uint256 minOut, uint256 valueUsd8) = quote(path, fees, amountIn, slippageBps);
        _consume(valueUsd8);
        amountOut = _execute(path, fees, amountIn, minOut);
        emit Traded(msg.sender, path[0], path[path.length - 1], amountIn, amountOut, valueUsd8);
    }

    function _consume(uint256 valueUsd8) internal {
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOn[msg.sender][day];
        uint256 limit = dailyLimit[msg.sender];
        if (spent + valueUsd8 > limit) revert DailyLimitExceeded(valueUsd8, limit > spent ? limit - spent : 0);
        spentOn[msg.sender][day] = spent + valueUsd8;
    }

    function _execute(address[] calldata path, uint24[] calldata fees, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 amountOut)
    {
        address tokenIn = path[0];
        if (msg.value != 0) {
            if (tokenIn != weth || msg.value != amountIn) revert BadEthAmount();
        } else {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(tokenIn).forceApprove(address(router), amountIn);
        }
        amountOut = router.exactInput{value: msg.value}(
            ISwapRouter02.ExactInputParams({
                path: _encodePath(path, fees),
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minOut
            })
        );
        if (msg.value == 0) IERC20(tokenIn).forceApprove(address(router), 0);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Minimum output the trade will accept and its USD value (8 decimals), from Chainlink.
    function quote(address[] calldata path, uint24[] calldata fees, uint256 amountIn, uint256 slippageBps)
        public
        view
        returns (uint256 minOut, uint256 valueUsd8)
    {
        if (path.length < 2 || path.length > MAX_HOPS + 1 || fees.length != path.length - 1 || amountIn == 0) {
            revert BadPath();
        }
        if (slippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        uint256 feeBps;
        for (uint256 i; i < path.length; ++i) {
            if (feedOf[path[i]] == address(0)) revert UnknownToken(path[i]);
            if (i > 0 && path[i] == path[i - 1]) revert BadPath();
            if (i < fees.length) feeBps += fees[i] / 100; // v3 fee unit: hundredths of a bip
        }
        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];
        if (tokenIn == tokenOut) revert BadPath();

        uint256 priceIn = price(tokenIn);
        uint256 priceOut = price(tokenOut);
        valueUsd8 = amountIn * priceIn / 10 ** _decimals(tokenIn);
        uint256 fairOut = valueUsd8 * 10 ** _decimals(tokenOut) / priceOut;
        if (feeBps + slippageBps >= 10_000) revert BadPath();
        minOut = fairOut * (10_000 - feeBps - slippageBps) / 10_000;
    }

    /// @notice Chainlink USD price of `token`, normalised to 8 decimals; reverts if stale or invalid.
    function price(address token) public view returns (uint256) {
        address feed = feedOf[token];
        if (feed == address(0)) revert UnknownToken(token);
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert BadPrice(token);
        if (block.timestamp - updatedAt > MAX_PRICE_AGE) revert StalePrice(token, updatedAt);
        uint8 d = IAggregatorV3(feed).decimals();
        return d == 8 ? uint256(answer) : uint256(answer) * USD / 10 ** d;
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    /// @notice USD (8 decimals) the caller can still trade today.
    function leftToday(address account) external view returns (uint256) {
        uint256 limit = dailyLimit[account];
        uint256 spent = spentOn[account][block.timestamp / 1 days];
        return limit > spent ? limit - spent : 0;
    }

    function _decimals(address token) internal view returns (uint8) {
        return token == weth ? 18 : IERC20Metadata(token).decimals();
    }

    function _encodePath(address[] calldata path, uint24[] calldata fees) internal pure returns (bytes memory p) {
        p = abi.encodePacked(path[0]);
        for (uint256 i; i < fees.length; ++i) {
            p = abi.encodePacked(p, fees[i], path[i + 1]);
        }
    }
}
