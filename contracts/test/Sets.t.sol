// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";

/// @notice Sets of four: the reveal hands out whole sets only, assembly, the one-time bonus, and the
/// ownership-cycle guard that keeps nested Faces movable.
contract SetsTest is Base {
    function _mintAndReveal(uint256 n) internal {
        _commitProvenance();
        _allowTestAsSeaDrop();
        while (faces.totalSupply() < n) {
            uint256 left = n - faces.totalSupply();
            faces.mintSeaDrop(alice, left > 100 ? 100 : left);
        }
        _reveal();
    }

    function _firstSet(uint256 n) internal view returns (uint256 setId, uint256[4] memory members) {
        for (uint256 id = 1; id <= n; ++id) {
            (setId,, members) = seeder.setOf(id);
            if (setId != 0) return (setId, members);
        }
        revert("no set");
    }

    function _dist(uint256 x, uint256 y, uint256 n) internal pure returns (uint256 d) {
        d = x > y ? x - y : y - x;
        if (n - d < d) d = n - d;
    }

    // ------------------------------------------------------------------
    // Reveal: whole sets only
    // ------------------------------------------------------------------
    function test_Sets_SellOutHandsOutAll555CompleteSets() public {
        _commitProvenance();
        _allowTestAsSeaDrop();
        for (uint256 i; i < 54; ++i) faces.mintSeaDrop(alice, 100);
        faces.mintSeaDrop(alice, 44);
        vm.prank(admin);
        faces.teamMint(admin, 111);
        _reveal();
        uint256[556] memory seen;
        uint256 pieces;
        for (uint256 id = 1; id <= 5555; ++id) {
            (uint256 setId, uint256 piece, uint256[4] memory m) = seeder.setOf(id);
            if (setId == 0) {
                assertLt(seeder.artIdOf(id), 3335, "singles use single art");
                continue;
            }
            ++pieces;
            ++seen[setId];
            assertEq(m[piece], id, "a Face is its own piece");
            assertEq(seeder.artIdOf(id), 3335 + 4 * (setId - 1) + piece, "piece art");
            uint8 tier = seeder.tierOf(m[0]);
            for (uint256 q; q < 4; ++q) {
                assertEq(seeder.tierOf(m[q]), tier, "a set shares its tier");
                for (uint256 r = q + 1; r < 4; ++r) {
                    assertGt(_dist(m[q], m[r], 5555), uint256(86), "no set from a run of consecutive ids");
                }
            }
        }
        assertEq(pieces, 2220);
        for (uint256 s = 1; s <= 555; ++s) assertEq(seen[s], 4, "every set complete");
    }

    function testFuzz_Sets_PartialSaleOnlyWholeSets(uint256 n) public {
        n = bound(n, 1, 700);
        _mintAndReveal(n);
        uint256 pieces;
        for (uint256 id = 1; id <= n; ++id) {
            (uint256 setId, uint256 piece, uint256[4] memory m) = seeder.setOf(id);
            if (setId == 0) continue;
            ++pieces;
            for (uint256 q; q < 4; ++q) {
                assertTrue(m[q] >= 1 && m[q] <= n, "every piece of a handed-out set was minted");
                (uint256 s2, uint256 p2,) = seeder.setOf(m[q]);
                assertEq(s2, setId);
                assertEq(p2, q);
            }
            assertEq(m[piece], id);
        }
        assertEq(pieces, 4 * seeder.setsIn(n));
    }

    function test_Sets_NothingBeforeReveal() public {
        _openPublic();
        _mintPublic(alice, 3);
        (uint256 setId,,) = seeder.setOf(1);
        assertEq(setId, 0);
        assertFalse(seeder.isAssembled(1));
    }

    // ------------------------------------------------------------------
    // Assembly + bonus
    // ------------------------------------------------------------------
    function _assemble(uint256[4] memory m, uint256 anchor) internal returns (address acc) {
        acc = seeder.accountOf(anchor);
        vm.startPrank(faces.ownerOf(anchor));
        for (uint256 q; q < 4; ++q) {
            if (m[q] != anchor) faces.safeTransferFrom(faces.ownerOf(m[q]), acc, m[q]);
        }
        vm.stopPrank();
    }

    function test_Sets_AssembleClaimBonusOnceThenTakeApart() public {
        _mintAndReveal(120);
        (uint256 setId, uint256[4] memory m) = _firstSet(120);
        assertFalse(seeder.isAssembled(m[0]));
        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetNotAssembled.selector, m[0]));
        seeder.claimSetBonus(m[0]);

        address acc = _assemble(m, m[0]);
        assertTrue(seeder.isAssembled(m[0]));
        assertFalse(seeder.isAssembled(m[1]), "only the anchor is assembled");

        uint256 before = spy.balanceOf(acc);
        vm.prank(carol); // permissionless: the keeper claims it for every assembled set
        seeder.claimSetBonus(m[0]);
        assertEq(spy.balanceOf(acc) - before, 0.013e18);
        assertEq(usdg.balanceOf(acc), 3e6);
        (uint32 anchorId, uint32 basketId) = seeder.setBonus(setId);
        assertEq(anchorId, m[0]);
        assertEq(basketId, 5);
        assertEq(seeder.setBonusCount(), 1);

        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetBonusAlreadyPaid.selector, setId));
        seeder.claimSetBonus(m[0]);

        // the holder takes the set apart through the anchor's account...
        vm.startPrank(alice);
        for (uint256 q = 1; q < 4; ++q) {
            NeonFaceAccount(payable(acc)).execute(
                address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, alice, m[q])), 0
            );
        }
        vm.stopPrank();
        assertFalse(seeder.isAssembled(m[0]));
        // ...and assembling it again around another piece earns nothing more
        _assemble(m, m[3]);
        assertTrue(seeder.isAssembled(m[3]));
        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetBonusAlreadyPaid.selector, setId));
        seeder.claimSetBonus(m[3]);
    }

    function test_Sets_BuyingTheAnchorBuysTheWholeSet() public {
        _mintAndReveal(120);
        (, uint256[4] memory m) = _firstSet(120);
        address acc = _assemble(m, m[0]);
        vm.prank(alice);
        faces.transferFrom(alice, bob, m[0]); // one sale
        assertTrue(seeder.isAssembled(m[0]));
        // bob now controls the three pieces inside, alice doesn't
        vm.prank(alice);
        vm.expectRevert();
        NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, alice, m[1])), 0);
        vm.prank(bob);
        NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, bob, m[1])), 0);
        assertEq(faces.ownerOf(m[1]), bob);
    }

    // ------------------------------------------------------------------
    // Ownership cycles: a Face can never end up owning itself
    // ------------------------------------------------------------------
    function test_Cycle_FaceIntoItsOwnAccountIsRefused() public {
        _openPublic();
        _mintPublic(alice, 2);
        address acc1 = seeder.accountOf(1);
        vm.startPrank(alice);
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.transferFrom(alice, acc1, 1); // plain transfer: no receiver hook to stop it
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.safeTransferFrom(alice, acc1, 1);
        vm.stopPrank();
        assertEq(faces.ownerOf(1), alice);
    }

    function test_Cycle_TwoFacesInsideEachOtherIsRefused() public {
        _openPublic();
        _mintPublic(alice, 2);
        vm.startPrank(alice);
        faces.transferFrom(alice, seeder.accountOf(1), 2); // 2 inside 1: fine
        vm.stopPrank();
        // 1 into 2's account would lock both forever (2's owner is 1's account)
        address acc2 = seeder.accountOf(2);
        vm.prank(alice);
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.transferFrom(alice, acc2, 1);
    }

    function test_Cycle_NestingDepthIsCapped() public {
        _openPublic(10);
        _mintPublic(alice, 6);
        // chain: 2 inside 1, 3 inside 2, 4 inside 3, 5 inside 4 -> 4 levels of Face accounts above 5
        vm.startPrank(alice);
        for (uint256 id = 2; id <= 5; ++id) {
            faces.transferFrom(alice, seeder.accountOf(id - 1), id);
        }
        // 6 into 5's account would be a 5th level
        address acc5 = seeder.accountOf(5);
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.transferFrom(alice, acc5, 6);
        vm.stopPrank();
    }

    function test_Cycle_MovingIntoAFaceRefreshesItsMetadata() public {
        _openPublic();
        _mintPublic(alice, 2);
        address acc1 = seeder.accountOf(1);
        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(1);
        vm.prank(alice);
        faces.transferFrom(alice, acc1, 2);

        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(1);
        vm.prank(alice);
        NeonFaceAccount(payable(acc1)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc1, bob, 2)), 0);
        assertEq(faces.ownerOf(2), bob);
    }

    function test_Cycle_OrdinaryTransfersUnaffected() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(alice);
        faces.transferFrom(alice, address(this), 1); // a contract that is not a Face account
        faces.transferFrom(address(this), bob, 1);
        assertEq(faces.ownerOf(1), bob);
    }
}
