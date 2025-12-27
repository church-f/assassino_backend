const { db } = require('./firestore');
const admin = require('firebase-admin');


function createRoles(players) {
    const roles = ['assassino', 'sbirro', 'rianimatrice'];
    const shuffledRoles = roles.sort(() => Math.random() - 0.5);
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

    shuffledPlayers.forEach((player, index) => {
        if (index < shuffledRoles.length) {
            player.role = shuffledRoles[index];
        } else {
            player.role = 'cittadino';
        }
    });

    return shuffledPlayers;
}

async function updateSinglePlayerStats(firebaseUid, { win, role }) {
  if (!firebaseUid) return; // skip se è guest

  const userRef = db().collection('users').doc(firebaseUid);
  
  await userRef.update({
    'statistiche.partite': admin.firestore.FieldValue.increment(1),
    'statistiche.vittorie': admin.firestore.FieldValue.increment(win ? 1 : 0),
    'statistiche.sconfitte': admin.firestore.FieldValue.increment(win ? 0 : 1),
    [`statistiche.${role}`]: admin.firestore.FieldValue.increment(1),
  });
}

async function updatePlayerStats(room, winningRole) {
    const updatePromises = room.players.map(player => {
        console.log(player.role, winningRole);
        const win = winningRole === 'assassino' && player.role === 'assassino' ||
                    winningRole === 'cittadini' && player.role !== 'assassino';
        return updateSinglePlayerStats(player.firebaseUid, { win, role: player.role });
    });

    await Promise.all(updatePromises);
}

module.exports = { createRoles, updatePlayerStats };