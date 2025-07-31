// AWS Amplify Auth setup
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

// Setup user pool only if environment variables are present
let userPool = null;
if (process.env.AWS_COGNITO_USER_POOL_ID && process.env.AWS_COGNITO_CLIENT_ID) {
  const poolData = {
    UserPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
    ClientId: process.env.AWS_COGNITO_CLIENT_ID,
  };
  userPool = new CognitoUserPool(poolData);
} else {
  console.warn('AWS Cognito configuration missing. Auth endpoints will return errors.');
}

// Signup handler
async function signupHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { username, password, email } = req.body;
  userPool.signUp(username, password, [{ Name: 'email', Value: email }], null, (err, result) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    res.status(200).json({ success: true, result });
  });
}

// Login handler
async function loginHandler(req, res) {
  if (!userPool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication service not configured. Please set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID environment variables.' 
    });
  }
  
  const { username, password } = req.body;
  const user = new CognitoUser({ Username: username, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: username, Password: password });
  user.authenticateUser(authDetails, {
    onSuccess: (result) => res.status(200).json({ success: true, result }),
    onFailure: (err) => res.status(401).json({ success: false, error: err.message }),
  });
}

export { signupHandler, loginHandler };
