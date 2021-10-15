const fs = require("fs");

const core = require("@actions/core");

const AliyunClient = require('@alicloud/pop-core');

const input = {
  accessKeyId: core.getInput("access-key-id"),
  accessKeySecret: core.getInput("access-key-secret"),
  securityToken: core.getInput("security-token"),
  fullchainFile: core.getInput("fullchain-file"),
  keyFile: core.getInput("key-file"),
  certificateName: core.getInput("certificate-name"),
  cdnDomains: core.getInput("cdn-domains")
};

/**
 * @param {string} endpoint
 * @param {string} apiVersion
 * @param {string} action
 * @param {Record<string, unknown>} params
 */
function callAliyunApi(endpoint, apiVersion, action, params) {
  return new AliyunClient({
    ...input.accessKeyId && input.accessKeySecret ? {
      accessKeyId: input.accessKeyId,
      accessKeySecret: input.accessKeySecret
    } : {},
    ...input.securityToken ? {
      securityToken: input.securityToken
    } : {},
    endpoint,
    apiVersion
  }).request(action, params, { method: "POST" });
}

async function deletePreviouslyDeployedCertificate() {
  /**
   * @typedef CertificateListItem
   * @prop {number} id
   * @prop {string} name
   * 
   * @typedef DescribeUserCertificateListResponse
   * @prop {number} TotalCount
   * @prop {CertificateListItem[]} CertificateList
   */

  /**
   * @param {(item: CertificateListItem) => Promise<void>} callback
   */
  async function listCertificates(callback) {
    let currentItems = 0;

    for (let i = 1; ; i++) {
      /**
       * @type {DescribeUserCertificateListResponse}
       */
      const response = await callAliyunApi(
        "https://cas.aliyuncs.com", "2018-07-13",
        "DescribeUserCertificateList",
        {
          ShowSize: 50,
          CurrentPage: i
        }
      );

      for (const item of response.CertificateList)
        await callback(item);

      currentItems += response.CertificateList.length;
      if (currentItems === response.TotalCount) break;
    }
  }

  let foundId = 0;
  await listCertificates(async item => {
    if (item.name === input.certificateName) {
      foundId = item.id;
    }
  });

  if (foundId === 0) {
    console.log("Previously deployed certificate not found. Skipping delete.");
    return;
  }

  console.log(`Found previously deployed certificate ${foundId}. Deleting.`);

  await callAliyunApi(
    "https://cas.aliyuncs.com", "2018-07-13",
    "DeleteUserCertificate",
    {
      CertId: foundId
    }
  );
}

async function deployCertificate() {
  const fullchain = fs.readFileSync(input.fullchainFile, "utf-8");
  const key = fs.readFileSync(input.keyFile, "utf-8");

  await deletePreviouslyDeployedCertificate();

  await callAliyunApi(
    "https://cas.aliyuncs.com", "2018-07-13",
    "CreateUserCertificate",
    {
      Cert: fullchain,
      Key: key,
      Name: input.certificateName
    }
  );
}

async function deployCertificateToCdn() {
  const domains = Array.from(new Set(input.cdnDomains.split(/\s+/).filter(x => x)));
  
  for (const domain of domains) {
    console.log(`Deploying certificate to CDN domain ${domain}.`);

    await callAliyunApi(
      "https://cdn.aliyuncs.com", "2018-05-10",
      "SetDomainServerCertificate",
      {
        DomainName: domain,
        CertName: input.certificateName,
        CertType: "cas",
        ServerCertificateStatus: "on",
        ForceSet: "1"
      }
    );
  }
}

async function main() {
  await deployCertificate();

  if (input.cdnDomains) await deployCertificateToCdn();
}

main().catch(error => {
  console.log(error.stack);
  core.setFailed(error);
  process.exit(1);
});
