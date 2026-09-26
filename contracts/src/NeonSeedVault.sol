// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {NeonSeeder} from "./NeonSeeder.sol";

/// @dev The part of NeonTrader the vault uses.
interface ISeedTrader {
    function weth() external view returns (address);
    function price(address token) external view returns (uint256 usd8);
    function setDailyLimit(uint256 usd8) external;
    function swap(address[] calldata path, uint24[] calldata fees, uint256 amountIn, uint256 slippageBps)
        external
        payable
        returns (uint256 amountOut);
}

/// @title NeonSeedVault — turns the seed share of the mint into the Faces' Stock Tokens
/// @notice Receives 50% of the creator share of every mint (from NeonPayout). The ETH can only leave as
/// basket tokens bought through NeonTrader (Uniswap v3, minimum output from Chainlink, ≤ 1% slippage) and
/// delivered straight to the NeonSeeder pool. The keeper chooses which basket token to buy and when (and keeps a
/// small stock ahead); anyone can `restock` what minted Faces are still owed, so no delivery depends on the
/// keeper. Nobody can send anything anywhere else. Once the baskets are locked (after the reveal) and the pool
/// holds everything it owes, any surplus can only go to the treasury.
contract NeonSeedVault is AccessControlDefaultAdminRules, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    uint256 public constant OWED_GRACE = 180 days;
    /// @notice `restock`: at most this much per call (8 decimals, USD), so one purchase never moves a pool far
    /// from its Chainlink price, and the most a sandwich could take from one call stays small.
    uint256 public constant MAX_RESTOCK_USD8 = 2_000e8;
    uint256 public constant RESTOCK_SLIPPAGE_BPS = 100;

    address payable public immutable treasury;
    NeonSeeder public seeder;
    ISeedTrader public trader;

    event SeederSet(address seeder);
    event TraderSet(address trader);
    event Bought(address indexed token, uint256 ethIn, uint256 amountOut);
    event Restocked(address indexed caller, address indexed token, uint256 ethIn, uint256 amountOut);
    event SurplusReleased(uint256 amount);

    error AlreadySet();
    error NotSet();
    error NotBasketToken(address token);
    error MustPayWithEth();
    error BasketsNotLocked();
    error SeedsStillOwed();
    error ZeroAddress();
    error NothingToRestock(address token);
    error VaultEmpty();
    /// @notice The pool can't fill this token within NeonTrader's bound right now (its price is more than 1% away
    /// from Chainlink, after pool fees): the vault never overpays, so the buy waits for the market to come back.
    error MarketOffPrice(address token);
    error UnknownDelivery(uint8 action);
    error BadPaths();

    /// @notice `restockAndDeliver` actions: what the seeder delivers once the pool holds it.
    uint8 public constant DELIVER_SEED = 1; // NeonSeeder.fund (every Face is activated in its mint)
    uint8 public constant DELIVER_TOP_UP = 2; // NeonSeeder.upgrade
    uint8 public constant DELIVER_SET_BONUS = 3; // NeonSeeder.claimSetBonus

    constructor(address payable treasury_, address admin) AccessControlDefaultAdminRules(2 days, admin) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

    receive() external payable {}

    /// @notice Wire the seed pool. Once (the seeder is deployed after the collection, which needs this vault's
    /// address for its payout split).
    function setSeeder(NeonSeeder seeder_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(seeder) != address(0)) revert AlreadySet();
        if (address(seeder_) == address(0)) revert ZeroAddress();
        seeder = seeder_;
        emit SeederSet(address(seeder_));
    }

    /// @notice Wire NeonTrader. Once (it is deployed later, only where Uniswap and Chainlink exist).
    function setTrader(ISeedTrader trader_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(trader) != address(0)) revert AlreadySet();
        if (address(trader_) == address(0)) revert ZeroAddress();
        trader = trader_;
        trader_.setDailyLimit(type(uint128).max); // the vault's spending is bounded by its balance, not per day
        emit TraderSet(address(trader_));
    }

    /// @notice Buy `path[last]` (a token used by a seed basket) with `ethIn` of the vault's ETH and put it
    /// in the seed pool. `path[0]` must be WETH; NeonTrader enforces the Chainlink-bounded minimum output.
    function buy(address[] calldata path, uint24[] calldata fees, uint256 ethIn, uint256 slippageBps)
        external
        nonReentrant
        onlyRole(KEEPER_ROLE)
        returns (uint256 amountOut)
    {
        ISeedTrader t = trader;
        if (address(t) == address(0) || address(seeder) == address(0)) revert NotSet();
        if (path[0] != t.weth()) revert MustPayWithEth();
        IERC20 token = IERC20(path[path.length - 1]);
        if (!isBasketToken(address(token))) revert NotBasketToken(address(token));
        t.swap{value: ethIn}(path, fees, ethIn, slippageBps);
        amountOut = token.balanceOf(address(this)); // the vault holds no tokens between buys
        token.safeTransfer(address(seeder), amountOut);
        emit Bought(address(token), ethIn, amountOut);
    }

    /// @notice Anyone: buy the basket token `path[last]` the pool is short of, i.e. what minted Faces are still owed
    /// (`NeonSeeder.owed` minus the pool's balance: pending seeds, top-ups, unpaid set bonuses), never more, up to
    /// `MAX_RESTOCK_USD8` per call. The ETH is sized from Chainlink (+3% for pool fees and slippage; any excess
    /// stays in the pool) and NeonTrader enforces the minimum output, so a caller chooses only the route, among
    /// listed pools whose fees NeonTrader caps. The keeper does this on its own; this is the door for anyone else.
    function restock(address[] calldata path, uint24[] calldata fees) external nonReentrant returns (uint256 amountOut) {
        amountOut = _restock(path, fees, false);
    }

    /// @notice Anyone, in one transaction: restock every token in `paths` the pool is short of (a token the pool
    /// already holds enough of is skipped), then make the seeder deliver `tokenId`'s seed, top-up or set bonus
    /// (`action`: DELIVER_SEED, DELIVER_TOP_UP, DELIVER_SET_BONUS). Same limits as `restock`. If a market is off
    /// its price, the whole call reverts with `MarketOffPrice(token)` before anything is bought or delivered:
    /// the site simulates first, so a holder never signs a transaction that would fail.
    function restockAndDeliver(uint8 action, uint256 tokenId, address[][] calldata paths, uint24[][] calldata fees)
        external
        nonReentrant
    {
        if (paths.length != fees.length) revert BadPaths();
        for (uint256 i; i < paths.length; ++i) {
            _restock(paths[i], fees[i], true);
        }
        NeonSeeder s = seeder;
        if (action == DELIVER_SEED) s.fund(tokenId);
        else if (action == DELIVER_TOP_UP) s.upgrade(tokenId);
        else if (action == DELIVER_SET_BONUS) s.claimSetBonus(tokenId);
        else revert UnknownDelivery(action);
    }

    function _restock(address[] calldata path, uint24[] calldata fees, bool skipIfHeld)
        internal
        returns (uint256 amountOut)
    {
        ISeedTrader t = trader;
        if (address(t) == address(0) || address(seeder) == address(0)) revert NotSet();
        if (path[0] != t.weth()) revert MustPayWithEth();
        address token = path[path.length - 1];
        uint256 ethIn = _restockEth(t, token);
        if (ethIn == 0) {
            if (skipIfHeld) return 0;
            revert NothingToRestock(token);
        }
        // Uniswap's "Too little received" (and any pool-side require) means the market can't fill at a fair price
        try t.swap{value: ethIn}(path, fees, ethIn, RESTOCK_SLIPPAGE_BPS) {}
        catch Error(string memory) {
            revert MarketOffPrice(token);
        }
        amountOut = IERC20(token).balanceOf(address(this)); // the vault holds no tokens between buys
        IERC20(token).safeTransfer(address(seeder), amountOut);
        emit Restocked(msg.sender, token, ethIn, amountOut);
    }

    /// @dev ETH to spend on `token`: what Faces are still owed minus what the pool holds, valued at Chainlink,
    /// capped at MAX_RESTOCK_USD8, +3% for pool fees and slippage. 0 when nothing is owed.
    function _restockEth(ISeedTrader t, address token) internal view returns (uint256 ethIn) {
        uint256 owed = seeder.owed(token);
        uint256 held = IERC20(token).balanceOf(address(seeder));
        if (owed <= held) return 0;
        uint256 usd8 = (owed - held) * t.price(token) / 10 ** IERC20Metadata(token).decimals();
        if (usd8 > MAX_RESTOCK_USD8) usd8 = MAX_RESTOCK_USD8;
        ethIn = usd8 * 1e18 * 103 / (t.price(t.weth()) * 100);
        if (address(this).balance == 0) revert VaultEmpty();
        if (ethIn > address(this).balance) ethIn = address(this).balance;
    }

    /// @notice After the baskets are locked, send leftover ETH to the treasury: once the pool holds everything it
    /// still owes to Faces (`NeonSeeder.covered()`), or after `OWED_GRACE` if some basket token can no longer be
    /// bought, so the ETH is never stuck.
    function releaseSurplus(uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(seeder) == address(0) || !seeder.configLocked()) revert BasketsNotLocked();
        if (!seeder.covered() && block.timestamp < seeder.lockedAt() + OWED_GRACE) revert SeedsStillOwed();
        emit SurplusReleased(amount);
        Address.sendValue(treasury, amount);
    }

    /// @notice True if `token` is a leg of any seed basket (base or top-up).
    function isBasketToken(address token) public view returns (bool) {
        uint256 n = seeder.basketCount();
        for (uint256 id = 1; id <= n; ++id) {
            NeonSeeder.Leg[] memory legs = seeder.basket(uint32(id));
            for (uint256 i; i < legs.length; ++i) {
                if (legs[i].token == token) return true;
            }
        }
        return false;
    }
}
