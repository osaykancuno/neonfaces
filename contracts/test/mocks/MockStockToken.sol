// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test / testnet stand-in for a Robinhood Chain Stock Token (18 decimals) or USDG (6 decimals).
/// `restricted` simulates a compliance gate that rejects transfers to non-allowlisted receivers.
contract MockStockToken is ERC20 {
    uint8 private immutable _decimals;
    bool public restricted;
    mapping(address => bool) public allowedReceiver;

    error ComplianceBlocked(address to);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setRestricted(bool r) external {
        restricted = r;
    }

    function setAllowedReceiver(address who, bool ok) external {
        allowedReceiver[who] = ok;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (restricted && from != address(0) && to != address(0) && !allowedReceiver[to]) {
            revert ComplianceBlocked(to);
        }
        super._update(from, to, value);
    }
}
