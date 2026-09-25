// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title NeonPayout — where the OpenSea drop pays mint proceeds, split on-chain
/// @notice SeaDrop sends the creator's part of every mint here (OpenSea keeps its drop fee).
/// NeonFaces only accepts this contract as SeaDrop's payout address, so the split below is the only
/// place mint money can go. Shares and payees are immutable; there is no owner.
///   50% Seed vault   — buys Stock Tokens / USDG that refill the NeonSeeder pool
///   20% Treasury     — multisig: art, site, audit, market making
///   15% Team         — an OpenZeppelin VestingWallet (linear, 6 months)
///   15% Growth       — collabs + growth
/// Anyone can push the split with `release()`; nobody can redirect it.
contract NeonPayout is ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant SEED_BPS = 5_000;
    uint256 public constant TREASURY_BPS = 2_000;
    uint256 public constant TEAM_BPS = 1_500;
    uint256 public constant GROWTH_BPS = 1_500;

    address payable public immutable seedVault;
    address payable public immutable treasury;
    address payable public immutable team;
    address payable public immutable growth;

    uint256 public totalReleased;
    mapping(address => uint256) public released;

    event Received(address indexed from, uint256 amount);
    event Released(address indexed payee, uint256 amount);

    error ZeroAddress();
    error DuplicatePayee();

    constructor(address payable seedVault_, address payable treasury_, address payable team_, address payable growth_) {
        if (seedVault_ == address(0) || treasury_ == address(0) || team_ == address(0) || growth_ == address(0)) {
            revert ZeroAddress();
        }
        if (
            seedVault_ == treasury_ || seedVault_ == team_ || seedVault_ == growth_ || treasury_ == team_
                || treasury_ == growth_ || team_ == growth_
        ) revert DuplicatePayee();
        seedVault = seedVault_;
        treasury = treasury_;
        team = team_;
        growth = growth_;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function payees() external view returns (address[4] memory accounts, uint256[4] memory shares) {
        accounts = [address(seedVault), address(treasury), address(team), address(growth)];
        shares = [SEED_BPS, TREASURY_BPS, TEAM_BPS, GROWTH_BPS];
    }

    function releasable(address payee) public view returns (uint256) {
        uint256 share = _shareOf(payee);
        if (share == 0) return 0;
        uint256 totalReceived = address(this).balance + totalReleased;
        return totalReceived * share / BPS - released[payee];
    }

    /// @notice Send `payee` its share of everything received so far.
    function release(address payable payee) public nonReentrant {
        uint256 amount = releasable(payee);
        if (amount == 0) return;
        released[payee] += amount;
        totalReleased += amount;
        emit Released(payee, amount);
        Address.sendValue(payee, amount);
    }

    /// @notice Push all four shares at once.
    function releaseAll() external {
        release(seedVault);
        release(treasury);
        release(team);
        release(growth);
    }

    function _shareOf(address payee) internal view returns (uint256) {
        if (payee == seedVault) return SEED_BPS;
        if (payee == treasury) return TREASURY_BPS;
        if (payee == team) return TEAM_BPS;
        if (payee == growth) return GROWTH_BPS;
        return 0;
    }
}
