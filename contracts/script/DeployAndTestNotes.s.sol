// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialNotes} from "../src/ConfidentialNotes.sol";
import {ConfidentialNotesVerifier} from "../src/ConfidentialNotesVerifier.sol";

/**
 * DeployAndTestNotes.s.sol
 *
 * Deploys the ConfidentialNotes system on Base mainnet AND runs the
 * full test in one atomic script:
 *   1. Deploy ConfidentialNotesVerifier
 *   2. Deploy ConfidentialNotes
 *   3. Seed the first note (commitment from the proof)
 *   4. Call createNote with the real Groth16 proof
 *
 * After this script runs, the createNote transaction is on BaseScan
 * with zero value, 4 hashes, no recipient, no amount.
 *
 * Run:
 *   forge script script/DeployAndTestNotes.s.sol \
 *     --rpc-url $BASE_RPC_URL \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast --slow
 */
contract DeployAndTestNotes is Script {
    // Proof constants (from scripts/zk_notes_prove.js)
    uint256 constant CN_NULLIFIER_HASH = 12474780686017284981558011096150493561577049897177766358017712367231036756846;
    uint256 constant CN_NEW_COMMITMENT = 13929342879246215742714996332281316098785822717664660472865995930974479050799;
    uint256 constant CN_ENCRYPTED_AMOUNT =
        11773251713321570768223971168099045156967731404017914016763351906581508186029;
    uint256 constant CN_ROOT = 9560046071838970884664866820431342388958052642239115089675197935631063605781;

    uint256 constant CN_PA0 = 2813897648553205654103312168621802019144146499286875334932128839498064292663;
    uint256 constant CN_PA1 = 3968975247409091911050026992097055891512743997803565405041485725217231293403;
    uint256 constant CN_PB00 = 2104596634504677451070655360396033327483604479584365869674418538535427985438;
    uint256 constant CN_PB01 = 4806645326162525650213313475808899787423185585694543004424039215094944843193;
    uint256 constant CN_PB10 = 3186647578246098714816148983335865908553032830233885722541624230868451025769;
    uint256 constant CN_PB11 = 49686005470590134960816744600440122456550145278732012205436193457299157844;
    uint256 constant CN_PC0 = 17951808626055457337612301388545691053491923385310867849189156332172758563177;
    uint256 constant CN_PC1 = 1683305029229658194071713690525627044194374421539665084300200476775096357946;

    uint256 constant CN_COMMITMENT = 10668627541551714631760004857481015688483280564974508968977414304541315990345;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // 1. Deploy the verifier
        ConfidentialNotesVerifier v = new ConfidentialNotesVerifier();
        console.log("ConfidentialNotesVerifier:", address(v));

        // 2. Deploy the notes contract
        ConfidentialNotes notes = new ConfidentialNotes(address(v), deployer);
        console.log("ConfidentialNotes:", address(notes));

        // 3. Seed the first note (insert the commitment into the tree)
        notes.seedNote(bytes32(CN_COMMITMENT));
        console.log("Note seeded. Root:", uint256(notes.currentRoot()));
        console.log("Note count:", notes.noteCount());

        // 4. Create a new note via ZK proof — ZERO VALUE, no USDC
        notes.createNote(
            [CN_PA0, CN_PA1],
            [[CN_PB00, CN_PB01], [CN_PB10, CN_PB11]],
            [CN_PC0, CN_PC1],
            [CN_NULLIFIER_HASH, CN_NEW_COMMITMENT, CN_ENCRYPTED_AMOUNT, CN_ROOT]
        );
        console.log("Note created. Note count:", notes.noteCount());
        console.log("SUCCESS: zero-value confidential note on Base");

        vm.stopBroadcast();
    }
}
