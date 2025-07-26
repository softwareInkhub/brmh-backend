from dataclasses import dataclass
from typing import Optional

@dataclass
class GeneratedSchema:
        self.id = data.get('id')  # type: string
        self.username = data.get('username')  # type: string
        self.email = data.get('email')  # type: string
        self.password = data.get('password')  # type: string
        self.full_name = data.get('full_name')  # type: string
        self.profile_image = data.get('profile_image')  # type: string
        self.bio = data.get('bio')  # type: string
        self.location = data.get('location')  # type: string
        self.website = data.get('website')  # type: string
        self.boards = data.get('boards')  # type: array
        self.followers = data.get('followers')  # type: array
        self.following = data.get('following')  # type: array
        self.created_at = data.get('created_at')  # type: string
        self.last_login = data.get('last_login')  # type: string
    
    @classmethod
    def from_dict(cls, data: dict):
        return cls(**data)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'password': self.password,
            'full_name': self.full_name,
            'profile_image': self.profile_image,
            'bio': self.bio,
            'location': self.location,
            'website': self.website,
            'boards': self.boards,
            'followers': self.followers,
            'following': self.following,
            'created_at': self.created_at,
            'last_login': self.last_login
        }
