from flask import Flask, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# Import routes
from routes import generatedapi
from routes import generatedapi

# Health check
@app.route('/health')
def health():
    return jsonify({'status': 'OK', 'service': 'pinterest'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
    print(f"🚀 pinterest server running on port {port}")
