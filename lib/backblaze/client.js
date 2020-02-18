const rp = require('request-promise-native');

module.exports = async function (id, key) {
  const {accountId, authorizationToken, apiUrl} = await rp({
    uri: 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${key}`).toString('base64')
    },
    json: true
  });
  return {
    apiUrl,
    authorizationToken,

    async createBucket(bucketName) {
      return rp({
        method: 'POST',
        uri: `${apiUrl}/b2api/v2/b2_create_bucket`,
        headers: {
          Authorization: authorizationToken
        },
        body: {
          accountId,
          bucketName,
          bucketType: 'allPrivate',
          corsRules: [
            {
              "corsRuleName": "uploads",
              "allowedOrigins": ["*"],
              "allowedHeaders": ["*"],
              "allowedOperations": [
                "b2_upload_file",
                "b2_upload_part"
              ],
              "exposeHeaders": ["x-bz-content-sha1"],
              "maxAgeSeconds": 3600
            }
          ]
        },
        json: true
      })
    },

    async createKey(keyName, bucketId) {
      return rp({
        method: 'POST',
        uri: `${apiUrl}/b2api/v2/b2_create_key`,
        headers: {
          Authorization: authorizationToken
        },
        body: {
          accountId,
          keyName,
          bucketId,
          capabilities: ['listFiles', 'readFiles', 'shareFiles', 'writeFiles', 'deleteFiles']
        },
        json: true
      })
    },

    async getUploadUrl(bucketId) {
      return rp({
        method: 'POST',
        uri: `${apiUrl}/b2api/v2/b2_get_upload_url`,
        headers: {
          Authorization: authorizationToken
        },
        body: {
          bucketId
        },
        json: true
      })
    },
  }
};
