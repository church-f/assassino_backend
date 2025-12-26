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

module.exports = { createRoles };