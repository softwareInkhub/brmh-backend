import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize both raw and document clients
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Fetch order IDs from shopify-inkhub-get-orders table with IDs that have 3 or fewer digits
 * @returns {Promise<Array>} Array of order IDs with short IDs
 */
export const fetchOrdersWithShortIds = async () => {
  try {
    console.log('🔍 Fetching order IDs with short IDs (3 digits or less)...');
    
    let allItems = [];
    let lastEvaluatedKey = undefined;
    let pageCount = 0;
    
    // Scan through ALL pages of data
    do {
      pageCount++;
      console.log(`📄 Scanning page ${pageCount}...`);
      
      const scanParams = {
        TableName: 'shopify-inkhub-get-products',
        Limit: 1000, // Scan 1000 items per page for efficiency
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
      };

      const command = new ScanCommand(scanParams);
      const response = await client.send(command);
      
      if (response.Items && response.Items.length > 0) {
        allItems = allItems.concat(response.Items);
        console.log(`📊 Page ${pageCount}: Found ${response.Items.length} items (Total so far: ${allItems.length})`);
      }
      
      lastEvaluatedKey = response.LastEvaluatedKey;
      
      // Debug: Log first few items from first page only
      if (pageCount === 1) {
        console.log('🔍 Sample items structure (RAW DynamoDB format):');
        response.Items.slice(0, 3).forEach((item, index) => {
          console.log(`Item ${index + 1}:`, {
            rawItem: JSON.stringify(item, null, 2),
            idField: item.id,
            idFieldType: typeof item.id,
            allKeys: Object.keys(item)
          });
        });
      }
      
    } while (lastEvaluatedKey);
    
    console.log(`📊 Completed scan: Found ${allItems.length} total orders across ${pageCount} pages`);

    if (allItems.length === 0) {
      console.log('❌ No items found in table');
      return [];
    }

    // Filter orders with IDs that have 3 or fewer digits and extract only the IDs
    const shortIdOrderIds = allItems
      .filter(item => {
        // Get the ID field from raw DynamoDB format
        const idField = item.id;
        let orderId = null;
        
        // Handle different DynamoDB formats
        if (idField && idField.S) {
          orderId = idField.S; // String format: {S: "000"}
        } else if (idField && idField.N) {
          orderId = idField.N; // Number format: {N: "123"}
        } else if (typeof idField === 'string') {
          orderId = idField; // Direct string
        } else if (typeof idField === 'number') {
          orderId = idField.toString(); // Direct number
        } else {
          return false;
        }
        
        // Handle different ID formats
        if (typeof orderId === 'number') {
          const length = orderId.toString().length;
          return length <= 3;
        } else if (typeof orderId === 'string') {
          // Remove any non-digit characters and check length
          const numericPart = orderId.replace(/\D/g, '');
          const length = numericPart.length;
          return length <= 3;
        }
        
        return false;
      })
      .map(item => {
        const idField = item.id;
        let orderId = null;
        
        // Handle different DynamoDB formats for return value
        if (idField && idField.S) {
          orderId = idField.S;
        } else if (idField && idField.N) {
          orderId = idField.N;
        } else if (typeof idField === 'string') {
          orderId = idField;
        } else if (typeof idField === 'number') {
          orderId = idField.toString();
        }
        
        return orderId;
      });

    console.log(`✅ Found ${shortIdOrderIds.length} order IDs with short IDs (3 digits or less)`);
    
    // Sort by ID for better readability
    shortIdOrderIds.sort((a, b) => {
      const idA = typeof a === 'number' ? a : parseInt(a) || 0;
      const idB = typeof b === 'number' ? b : parseInt(b) || 0;
      return idA - idB;
    });

    // Log the found order IDs for debugging
    console.log(`📦 Order IDs found: [${shortIdOrderIds.join(', ')}]`);

    return shortIdOrderIds;

  } catch (error) {
    console.error('❌ Error fetching order IDs with short IDs:', error);
    throw error;
  }
};

/**
 * Handler function for the API route
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const fetchOrdersWithShortIdsHandler = async (req, res) => {
  try {
    console.log('🚀 Fetch order IDs with short IDs API called');
    
    const orderIds = await fetchOrdersWithShortIds();
    
    res.json({
      success: true,
      message: `Found ${orderIds.length} order IDs with short IDs (3 digits or less)`,
      count: orderIds.length,
      orderIds: orderIds
    });

  } catch (error) {
    console.error('❌ Error in fetchOrdersWithShortIdsHandler:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order IDs with short IDs',
      message: error.message
    });
  }
};
