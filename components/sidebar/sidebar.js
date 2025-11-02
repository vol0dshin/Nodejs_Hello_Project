async function createRoom() {
      if (!this.newRoomName.trim()) return;
      try {
        const res = await fetch('https://matrix.org/_matrix/client/r0/createRoom', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`
          },
          body: JSON.stringify({ preset: 'private_chat', name: this.newRoomName.trim(), invite: this.inviteUser ? [this.inviteUser.trim()] : [] })
        });
        const data = await res.json();
        if (data.room_id) {
          this.newRoomId = data.room_id;
          this.roomId = data.room_id;
          this.messages = [];
          this.lastSyncToken = '';
          await this.fetchRoomsWithNames();
          this.fetchMessages();
          this.inviteUser = '';
          alert(`Room ${this.newRoomName} created with ID: ${this.newRoomId}`);
        } else {
          console.error('Create room failed:', data);
          alert('Create room failed: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        console.error('Create room error:', e);
        alert('Create room error: ' + e.message);
      }
    }
 async function fetchRoomsWithNames() {
      if (!this.accessToken) return;
      try {
        const res = await fetch('https://matrix.org/_matrix/client/r0/joined_rooms', {
          headers: { 'Authorization': `Bearer ${this.accessToken}` }
        });
        const data = await res.json();
        if (data.joined_rooms) {
          const roomPromises = data.joined_rooms.map(async (roomId) => {
            const nameRes = await fetch(`https://matrix.org/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/state/m.room.name`, {
              headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            const nameData = await nameRes.json();
            return {
              roomId,
              name: nameData?.name || this.getRoomName(roomId) || roomId
            };
          });
          this.rooms = (await Promise.all(roomPromises))
            .sort((a, b) => a.roomId.localeCompare(b.roomId));
          if (this.rooms.length > 0 && !this.roomId) {
            this.roomId = this.rooms[0].roomId;
            this.fetchMessages();
          }
        }
      } catch (e) {
        console.error('Fetch rooms error:', e);
      }
    }
