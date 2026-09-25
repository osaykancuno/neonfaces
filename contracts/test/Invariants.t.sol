// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonPayout} from "../src/NeonPayout.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";

/// @dev Random sequences of what can happen to the collection: sales through SeaDrop's entrypoint, team
/// mints, transfers, payouts, pauses, the reveal and top-ups.
contract Handler is Test {
    NeonFaces immutable faces;
    NeonSeeder immutable seeder;
    NeonPayout immutable payout;
    address immutable admin;
    address[4] users;
    uint256 public paidIn;

    constructor(NeonFaces f, NeonSeeder s, NeonPayout p, address a) {
        (faces, seeder, payout, admin) = (f, s, p, a);
        users = [makeAddr("u1"), makeAddr("u2"), makeAddr("u3"), makeAddr("u4")];
    }

    function sell(uint256 who, uint256 qty) external {
        qty = bound(qty, 1, 20);
        if (faces.mintClosed() || faces.mintPaused() || faces.publicMinted() + qty > faces.PUBLIC_CAP()) return;
        faces.mintSeaDrop(users[who % 4], qty); // this handler is an allowed SeaDrop
    }

    function teamMint(uint256 qty) external {
        qty = bound(qty, 1, 10);
        if (faces.mintClosed() || faces.teamMinted() + qty > faces.TEAM_CAP()) return;
        vm.prank(admin);
        faces.teamMint(admin, qty);
    }

    function transfer(uint256 id, uint256 to) external {
        uint256 supply = faces.totalSupply();
        if (supply == 0) return;
        id = bound(id, 1, supply);
        address from = faces.ownerOf(id);
        vm.prank(from);
        faces.transferFrom(from, users[to % 4], id);
    }

    function pay(uint256 amount) external {
        amount = bound(amount, 0, 10 ether);
        vm.deal(address(this), amount);
        (bool ok,) = address(payout).call{value: amount}("");
        require(ok);
        paidIn += amount;
    }

    function release(uint256 which) external {
        (address[4] memory accounts,) = payout.payees();
        payout.release(payable(accounts[which % 4]));
    }

    function pause(bool p) external {
        vm.prank(admin);
        faces.setMintPaused(p);
    }

    function reveal() external {
        if (faces.revealSeed() != 0 || faces.totalSupply() == 0) return;
        vm.startPrank(admin);
        if (faces.revealBlock() == 0) faces.requestReveal();
        vm.stopPrank();
        vm.roll(block.number + 6);
        faces.reveal();
    }

    function upgrade(uint256 id) external {
        uint256 supply = faces.totalSupply();
        if (supply == 0 || faces.revealSeed() == 0) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = bound(id, 1, supply);
        seeder.upgradeBatch(ids);
    }
}

contract InvariantsTest is Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        _commitProvenance();
        handler = new Handler(faces, seeder, payout, admin);
        address[] memory allowed = new address[](2);
        (allowed[0], allowed[1]) = (SEADROP, address(handler));
        vm.startPrank(admin);
        faces.updateAllowedSeaDrop(allowed);
        faces.grantRole(faces.METADATA_ROLE(), admin);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// Supply can never exceed what the bytecode allows, and every id is accounted for.
    function invariant_SupplyCaps() public view {
        assertEq(faces.totalSupply(), faces.publicMinted() + faces.teamMinted());
        assertLe(faces.publicMinted(), faces.PUBLIC_CAP());
        assertLe(faces.teamMinted(), faces.TEAM_CAP());
        assertLe(faces.totalSupply(), faces.MAX_SUPPLY());
        assertLe(faces.maxSupply(), faces.MAX_SUPPLY());
    }

    /// Every Face that exists has its account; nothing is minted after the reveal request.
    function invariant_EveryFaceIsActivated() public view {
        assertEq(seeder.activatedCount(), faces.totalSupply());
        if (faces.mintClosed()) assertEq(faces.maxSupply(), faces.totalSupply());
    }

    /// The split never pays more than it received, and each payee gets exactly its share over time.
    function invariant_PayoutAccounting() public view {
        uint256 received = address(payout).balance + payout.totalReleased();
        assertEq(received, handler.paidIn());
        (address[4] memory accounts, uint256[4] memory shares) = payout.payees();
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            uint256 due = payout.released(accounts[i]) + payout.releasable(accounts[i]);
            assertEq(due, received * shares[i] / 10_000);
            sum += due;
        }
        assertLe(sum, received);
    }

    /// Seeds: nothing is funded or topped up twice, and top-ups only happen after the reveal.
    function invariant_SeedCounters() public view {
        assertLe(seeder.fundedCount(), seeder.activatedCount());
        assertLe(seeder.upgradedCount(), seeder.activatedCount());
        if (faces.revealSeed() == 0) assertEq(seeder.upgradedCount(), 0);
    }
}
