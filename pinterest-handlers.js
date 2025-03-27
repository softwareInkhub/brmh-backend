import axios from 'axios';

export const handlers = {
    getPinterestToken: async (c, req, res) => {
        console.log('Incoming Request Body:', c.request.requestBody);
        const { code, clientId, clientSecret, redirectUrl } = c.request.requestBody;

        // Check if any of the required fields are missing
        if (!code || !clientId || !clientSecret || !redirectUrl) {
            return {
                statusCode: 400,
                body: { error: 'Missing required fields' }
            };
        }

        const tokenRequestBody = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUrl
        }).toString();

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        try {
            const response = await axios.post('https://api.pinterest.com/v5/oauth/token', tokenRequestBody, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return {
                statusCode: 200,
                body: response.data.access_token
            };
        } catch (error) {
            console.error('Error fetching token:', error.response ? error.response.data : error.message);
            return {
                statusCode: 500,
                body: { error: 'Failed to fetch token' }
            };
        }
    },

    testPinterestApi: async (c, req, res) => {
        try {
            const { url, token, params } = c.request.requestBody;

            if (!url) {
                return {
                    statusCode: 400,
                    body: { error: 'URL is required' }
                };
            }

            const apiUrl = new URL(url);
            if (params) {
                Object.keys(params).forEach(key => {
                    apiUrl.searchParams.append(key, params[key]);
                });
            }

            const response = await axios.get(apiUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                statusCode: 200,
                body: response.data
            };
        } catch (error) {
            console.error('Error fetching data:', error);
            if (error.response) {
                console.error('Error response data:', error.response.data);
                console.error('Error response status:', error.response.status);
            } else {
                console.error('Error message:', error.message);
            }
            return {
                statusCode: 500,
                body: { 
                    error: 'Failed to fetch data', 
                    details: error.message 
                }
            };
        }
    }
}; 