class User {
  constructor(data) {
    this.id = data.id; // type: string
    this.name = data.name; // type: string
    this.email = data.email; // type: string
    this.age = data.age; // type: number
  }
}

module.exports = User;
