const fs = require("fs");

const core = require("@actions/core");

const AliyunClient = require("@alicloud/pop-core");

const input = {
  accessKeyId: core.getInput("access-key-id"),
  accessKeySecret: core.getInput("access-key-secret"),
  securityToken: core.getInput("security-token"),
  fullchainFile: core.getInput("fullchain-file"),
  keyFile: core.getInput("key-file"),
  certificateName: core.getInput("certificate-name"),
  cdnDomains: core.getInput("cdn-domains"),
  timeout: parseInt(core.getInput("timeout")) || 10000,
  retry: parseInt(core.getInput("retry")) || 3,
  useIntlEndpoint: core.getBooleanInput("use-intl-endpoint") || false
};

const baseDomain = input.useIntlEndpoint ? "ap-southeast-1.aliyuncs.com" : "aliyuncs.com";
const casEndpoint = `https://cas.${baseDomain}`;
const cdnEndpoint = `https://cdn.${baseDomain}`;

/**
 * @param {string} endpoint
 * @param {string} apiVersion
 * @param {string} action
 * @param {Record<string, unknown>} params
 */
function callAliyunApi(endpoint, apiVersion, action, params) {
  return new Promise((resolve, reject) => {
    let retryTimes = 0;
    const client = new AliyunClient({
      ...input.accessKeyId && input.accessKeySecret ? {
        accessKeyId: input.accessKeyId,
        accessKeySecret: input.accessKeySecret
      } : {},
      ...input.securityToken ? {
        securityToken: input.securityToken
      } : {},
      endpoint,
      apiVersion
    });

    const request = () => client
      .request(action, params, { method: "POST", timeout: input.timeout })
      .then(resolve)
      .catch(error => {
        console.log(`Aliyun Client Error ${++retryTimes}/${input.retry}`, error)
        if (retryTimes >= input.retry) reject(error);
        request();
      });
    request();
  });
}

async function deletePreviouslyDeployedCertificate() {
  /**
   * @typedef CertificateOrderListItem
   * @prop {number} CertificateId
   * @prop {string} Name
   * 
   * @typedef ListUserCertificateOrderResponse
   * @prop {number} TotalCount
   * @prop {CertificateOrderListItem[]} CertificateOrderList
   */

  /**
   * @param {(item: CertificateOrderListItem) => Promise<void>} callback
   */
  async function listCertificates(callback) {
    const ALL_STATUS = ["ISSUED", "WILLEXPIRED", "EXPIRED"];
    for (const status of ALL_STATUS) {
      let currentItems = 0;
      for (let i = 1; ; i++) {
        console.log(`ListUserCertificateOrder: status = ${status}, page = ${i}.`);
        /**
         * @type {ListUserCertificateOrderResponse}
         */
        const response = await callAliyunApi(
          casEndpoint, "2020-04-07",
          "ListUserCertificateOrder",
          {
            Status: status,
            OrderType: "CERT",
            ShowSize: 50,
            CurrentPage: i
          }
        );

        for (const item of response.CertificateOrderList)
          await callback(item);

        currentItems += response.CertificateOrderList.length;
        if (currentItems === response.TotalCount) break;
      }
    }
  }

  let foundId = 0;
  await listCertificates(async item => {
    if (item.Name === input.certificateName) {
      foundId = item.CertificateId;
    }
  });

  if (foundId === 0) {
    console.log("Previously deployed certificate not found. Skipping delete.");
    return;
  }

  console.log(`Found previously deployed certificate ${foundId}. Deleting.`);

  await callAliyunApi(
    casEndpoint, "2020-04-07",
    "DeleteUserCertificate",
    {
      CertId: foundId
    }
  );
}

/**
 * @returns {Promise<number>} CertId
 */
async function deployCertificate() {
  const fullchain = fs.readFileSync(input.fullchainFile, "utf-8");
  const key = fs.readFileSync(input.keyFile, "utf-8");

  await deletePreviouslyDeployedCertificate();

  const response = await callAliyunApi(
    casEndpoint, "2020-04-07",
    "UploadUserCertificate",
    {
      Cert: fullchain,
      Key: key,
      Name: input.certificateName
    }
  );
  return response.CertId;
}

/**
 * @param {number} certId
 */
async function deployCertificateToCdn(certId) {
  const domains = Array.from(new Set(input.cdnDomains.split(/\s+/).filter(x => x)));

  for (const domain of domains) {
    console.log(`Deploying certificate to CDN domain ${domain}.`);

    await callAliyunApi(
      cdnEndpoint, "2018-05-10",
      "SetCdnDomainSSLCertificate",
      {
        DomainName: domain,
        CertName: input.certificateName,
        CertId: certId,
        CertType: "cas",
        SSLProtocol: "on",
        CertRegion: input.useIntlEndpoint ? "ap-southeast-1" : "cn-hangzhou"
      }
    );
  }
}

async function main() {
  const certId = await deployCertificate();
  console.log(`Deployed certificate ${certId}.`);
  if (input.cdnDomains) await deployCertificateToCdn(certId);
}

main().catch(error => {
  console.log(error.stack);
  core.setFailed(error);
  process.exit(1);
});
