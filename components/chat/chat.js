async function sendMessage() {
  if (!this.newMessage.trim() || !this.roomId) {
    console.warn('No message or roomId');
    return;
  }
  const msg = this.newMessage.trim();
  this.newMessage = '';


  try {
    const res = await fetch(`https://matrix.org/_matrix/client/r0/rooms/${this.roomId}/send/m.room.message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`
      },
      body: JSON.stringify({ msgtype: 'm.text', body: msg })
    });
    const data = await res.json();
    if (data.event_id) {
      this.messages.push({ id: data.event_id, body: msg, sender: this.userId });
    } else {
      console.error('Send failed:', data);
    }
  } catch (e) {
    console.error('Send message error:', e);
  }
}


async function fetchMessages() {
  if (!this.accessToken || !this.roomId) return;

  try {
    const url = this.lastSyncToken
      ? `https://matrix.org/_matrix/client/r0/sync?since=${this.lastSyncToken}&timeout=30000`
      : `https://matrix.org/_matrix/client/r0/sync?timeout=30000`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.accessToken}` }
    });

    const data = await res.json();

    if (!data.next_batch) {
      console.warn('No next_batch in sync response:', data);
      return;
    }

    this.lastSyncToken = data.next_batch;

    const roomData = data.rooms?.join?.[this.roomId];
    if (!roomData || !roomData.timeline?.events) return;

    roomData.timeline.events.forEach(event => {

      // ------------------------------------
      // ОБРОБКА ЗВИЧАЙНИХ ПОВІДОМЛЕНЬ
      // ------------------------------------
      if (event.type === 'm.room.message') {

        const relates = event.content?.['m.relates_to'];
        const isEdit = relates?.rel_type === 'm.replace';

        // ============================
        // 1) РЕДАГУВАННЯ
        // ============================
        if (isEdit) {
          const targetId = relates.event_id;
          const msg = this.messages.find(m => m.id === targetId);

          // Якщо є локальне редагування — Matrix не повинен перезаписувати
          if (this.localEdits[targetId]) {
            if (msg) {
              msg.body = this.localEdits[targetId];
              msg.edited = true;
            }
            return;
          }

          // нормальне редагування з Matrix
          if (msg) {
            const newBody = event.content?.['m.new_content']?.body;
            if (newBody) msg.body = newBody;
            msg.edited = true;
          }

          return;
        }

        // ============================
        // 2) ЗВИЧАЙНЕ ПОВІДОМЛЕННЯ
        // ============================

        // ❗ локально видалене → ігнорувати
        if (this.localDeletes.has(event.event_id)) {
          return;
        }

        // ❗ пропуск, якщо вже є
        if (this.messages.find(m => m.id === event.event_id)) return;

        const newMsg = {
          id: event.event_id,
          body: event.content.body,
          sender: event.sender,
          edited: false
        };

        // ❗ якщо це повідомлення було редаговано локально
        if (this.localEdits[newMsg.id]) {
          newMsg.body = this.localEdits[newMsg.id];
          newMsg.edited = true;
        }

        this.messages.push(newMsg);

        // нотифікації
        if (event.sender !== this.userId && document.hidden) {
          this.showDesktopNotification(event.sender, event.content.body);
          this.playNotificationSound();
        }
      }

      // ------------------------------------
      // 3) ВИДАЛЕННЯ (REDACTION)
      // ------------------------------------
      if (event.type === 'm.room.redaction' && event.redacts) {

        // Якщо ми вже локально видалили — не відкатувати назад
        this.localDeletes.add(event.redacts);

        this.messages = this.messages.filter(m => m.id !== event.redacts);
      }
    });

    await this.fetchRoomsWithNames();

  } catch (e) {
    console.error('Fetch messages error:', e);
  }
}



function startEdit(messageId, currentBody) {
  this.editMode = messageId;
  this.editText = currentBody;

  this.$nextTick(() => {
    const textarea = document.querySelector(`[x-show="editMode === '${messageId}'"] textarea`);
    if (textarea) textarea.focus();
  });
}

function cancelEdit() {
  this.editMode = null;
  this.editText = '';
}

async function saveEdit(messageId) {
  const newBody = this.editText.trim();
  if (!newBody) return;

  // ЛОКАЛЬНИЙ КЕШ редагувань
  this.localEdits[messageId] = newBody;

  // миттєво оновлюємо UI
  const msg = this.messages.find(m => m.id === messageId);
  if (msg) {
    msg.body = newBody;
    msg.edited = true;
  }

  this.cancelEdit();

  // відправка Matrix event
  try {
    await fetch(
      `https://matrix.org/_matrix/client/r0/rooms/${this.roomId}/send/m.room.message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        },
        body: JSON.stringify({
          "msgtype": "m.text",
          "body": `* ${newBody}`,
          "m.new_content": { "msgtype": "m.text", "body": newBody },
          "m.relates_to": { "rel_type": "m.replace", "event_id": messageId }
        })
      }
    );
  } catch (e) {
    console.error(e);
  }
}



async function deleteMessage(messageId) {
  if (!confirm("Видалити повідомлення?")) return;

  // кешуємо видалення локально
  this.localDeletes.add(messageId);

  // миттєво прибираємо з UI
  this.messages = this.messages.filter(m => m.id !== messageId);

  await fetch(
    `https://matrix.org/_matrix/client/r0/rooms/${this.roomId}/redact/${messageId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: "deleted" })
    }
  );
}



function playNotificationSound() {
  const audio = new Audio('./assets/ping.mp3');
  audio.volume = 0.5;
  audio.play().catch(e => console.log('Sound blocked:', e));
}

function showDesktopNotification(sender, body) {
  if (Notification.permission !== 'granted') return;

  const title = sender === this.userId ? 'Ти' : sender.split(':')[0].substring(1);

  const notification = new Notification(title, {
    body: body.length > 100 ? body.substring(0, 97) + '...' : body,
    icon: './assets/icon.png',
    tag: 'matrix-chat',
    renotify: true
  });

  setTimeout(() => notification.close(), 5000);

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
