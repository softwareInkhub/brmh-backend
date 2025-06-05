import { SNSClient, ListTopicsCommand, CreateTopicCommand, DeleteTopicCommand, PublishCommand } from "@aws-sdk/client-sns";
import { SQSClient, ListQueuesCommand, CreateQueueCommand, DeleteQueueCommand, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

// Initialize AWS clients
const snsClient = new SNSClient({
  region: process.env.AWS_REGION
});

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION
});

export const handlers = {
  // SNS Handlers
  listSnsTopics: async (c, req, res) => {
    try {
      const command = new ListTopicsCommand({});
      const response = await snsClient.send(command);

      return {
        statusCode: 200,
        body: {
          topics: response.Topics.map(topic => ({
            topicArn: topic.TopicArn,
            name: topic.TopicArn.split(':').pop()
          }))
        }
      };
    } catch (error) {
      console.error('[SNS] List Topics Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to list SNS topics', details: error.message }
      };
    }
  },

  createSnsTopic: async (c, req, res) => {
    try {
      const { name, tags } = c.request.requestBody;
      const command = new CreateTopicCommand({
        Name: name,
        Tags: Object.entries(tags || {}).map(([key, value]) => ({ Key: key, Value: value }))
      });

      const response = await snsClient.send(command);

      return {
        statusCode: 201,
        body: {
          topicArn: response.TopicArn,
          name: name,
          tags: tags || {}
        }
      };
    } catch (error) {
      console.error('[SNS] Create Topic Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to create SNS topic', details: error.message }
      };
    }
  },

  deleteSnsTopic: async (c, req, res) => {
    try {
      const { topicArn } = c.request.params;
      const command = new DeleteTopicCommand({
        TopicArn: topicArn
      });

      await snsClient.send(command);

      return {
        statusCode: 204
      };
    } catch (error) {
      console.error('[SNS] Delete Topic Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to delete SNS topic', details: error.message }
      };
    }
  },

  publishToSnsTopic: async (c, req, res) => {
    try {
      const { topicArn, message, subject, messageAttributes } = c.request.requestBody;
      const command = new PublishCommand({
        TopicArn: topicArn,
        Message: message,
        Subject: subject,
        MessageAttributes: messageAttributes
      });

      const response = await snsClient.send(command);

      return {
        statusCode: 200,
        body: {
          messageId: response.MessageId
        }
      };
    } catch (error) {
      console.error('[SNS] Publish Message Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to publish message', details: error.message }
      };
    }
  },

  // SQS Handlers
  listSqsQueues: async (c, req, res) => {
    try {
      const command = new ListQueuesCommand({});
      const response = await sqsClient.send(command);

      return {
        statusCode: 200,
        body: {
          queues: (response.QueueUrls || []).map(queueUrl => ({
            queueUrl,
            name: queueUrl.split('/').pop()
          }))
        }
      };
    } catch (error) {
      console.error('[SQS] List Queues Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to list SQS queues', details: error.message }
      };
    }
  },

  createSqsQueue: async (c, req, res) => {
    try {
      const { name, attributes, tags } = c.request.requestBody;
      const command = new CreateQueueCommand({
        QueueName: name,
        Attributes: attributes,
        tags: tags
      });

      const response = await sqsClient.send(command);

      return {
        statusCode: 201,
        body: {
          queueUrl: response.QueueUrl,
          name: name,
          attributes: attributes || {},
          tags: tags || {}
        }
      };
    } catch (error) {
      console.error('[SQS] Create Queue Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to create SQS queue', details: error.message }
      };
    }
  },

  deleteSqsQueue: async (c, req, res) => {
    try {
      const { queueUrl } = c.request.params;
      const command = new DeleteQueueCommand({
        QueueUrl: queueUrl
      });

      await sqsClient.send(command);

      return {
        statusCode: 204
      };
    } catch (error) {
      console.error('[SQS] Delete Queue Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to delete SQS queue', details: error.message }
      };
    }
  },

  sendMessage: async (c, req, res) => {
    try {
      const { queueUrl, message, delaySeconds, messageAttributes } = c.request.requestBody;
      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: message,
        DelaySeconds: delaySeconds,
        MessageAttributes: messageAttributes
      });

      const response = await sqsClient.send(command);

      return {
        statusCode: 200,
        body: {
          messageId: response.MessageId
        }
      };
    } catch (error) {
      console.error('[SQS] Send Message Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to send message', details: error.message }
      };
    }
  },

  receiveMessages: async (c, req, res) => {
    try {
      const { queueUrl } = c.request.params;
      const { maxMessages, waitTimeSeconds } = c.request.query;
      
      const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages || 1,
        WaitTimeSeconds: waitTimeSeconds || 0,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All']
      });

      const response = await sqsClient.send(command);

      return {
        statusCode: 200,
        body: {
          messages: (response.Messages || []).map(msg => ({
            messageId: msg.MessageId,
            receiptHandle: msg.ReceiptHandle,
            body: msg.Body,
            attributes: msg.Attributes,
            messageAttributes: msg.MessageAttributes,
            md5OfBody: msg.MD5OfBody
          }))
        }
      };
    } catch (error) {
      console.error('[SQS] Receive Messages Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to receive messages', details: error.message }
      };
    }
  },

  deleteMessage: async (c, req, res) => {
    try {
      const { queueUrl } = c.request.params;
      const { receiptHandle } = c.request.requestBody;
      
      const command = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle
      });

      await sqsClient.send(command);

      return {
        statusCode: 204
      };
    } catch (error) {
      console.error('[SQS] Delete Message Error:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to delete message', details: error.message }
      };
    }
  }
}; 