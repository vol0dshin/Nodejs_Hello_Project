async function login() {
  try {
    const res = await fetch('https://matrix.org/_matrix/client/r0/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.password', user: this.username, password: this.password })
    });
    const data = await res.json();
    if (data.access_token) {
      this.accessToken = data.access_token;
      this.userId = data.user_id;
      await this.fetchRoomsWithNames();
      this.fetchMessages();
      setInterval(() => {
        this.fetchRoomsWithNames();
        this.fetchMessages();
      }, 5000);
    } else {
      this.error = 'Login failed: ' + (data.error || 'Unknown error');
    }
  } catch (e) {
    this.error = 'Error during login: ' + e.message;
    console.error(e);
  }
}
