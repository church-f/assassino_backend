const { createRoles, updatePlayerStats } = require('../../utils');

describe('Utils Functions', () => {
  describe('createRoles', () => {
    test('should assign roles correctly to players', () => {
      const players = [
        { playerId:  '1', name: 'Player1' },
        { playerId: '2', name: 'Player2' },
        { playerId: '3', name: 'Player3' },
        { playerId: '4', name: 'Player4' },
        { playerId: '5', name: 'Player5' },
      ];
      
      const result = createRoles(players);
      
      expect(result).toHaveLength(5);
      expect(result.every(p => p.role)).toBeTruthy();
      expect(['assassino', 'sbirro', 'rianimatrice']).toEqual(
        expect.arrayContaining(result.slice(0, 3).map(p => p.role))
      );
      expect(result.slice(3).every(p => p.role === 'cittadino')).toBeTruthy();

      // Verify exact role counts
      const roleCount = result.reduce((acc, player) => {
        acc[player.role] = (acc[player.role] || 0) + 1;
        return acc;
      }, {});
      
      expect(roleCount['assassino']).toBe(1);
      expect(roleCount['sbirro']).toBe(1);
      expect(roleCount['rianimatrice']).toBe(1);
      expect(roleCount['cittadino']).toBe(2);
    });
  });

  describe('updatePlayerStats', () => {
    test('should update player statistics', () => {
      // Test implementation
    });
  });
});