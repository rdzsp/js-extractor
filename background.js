// background.js - Service worker / background page
// Handles any cross-tab messaging if needed in future

browser.runtime.onInstalled.addListener(() => {
  // Seed with a builtin group on first install
  browser.storage.local.get('groups').then(data => {
    if (!data.groups) {
      const endpointsGroup = {
        id: 'group-endpoints',
        name: 'Endpoints / URLs',
        patterns: [
          {
            id: 'endpoint-full-url',
            regex: `(?:"|')((?:[a-zA-Z]{1,10}:\\/\\/|\\/\\/)[^"'\\/]{1,}\\.[a-zA-Z]{2,}[^"']{0,})(?:"|')`,
            description: 'Full URLs with scheme or protocol-relative'
          },
          {
            id: 'endpoint-relative-path',
            regex: `(?:"|')((?:\\/|\\.\\.\\/|\\.\\/)[^"'><,;| *()\\[\\]]{2,})(?:"|')`,
            description: 'Relative paths'
          },
          {
            id: 'endpoint-with-extension',
            regex: `(?:"|')([a-zA-Z0-9_\\-/]+\\/[a-zA-Z0-9_\\-/.]+\\.(?:[a-zA-Z]{1,4}|action)(?:[?#][^"' ]*)?)(?:"|')`,
            description: 'Endpoints with file extensions'
          },
          {
            id: 'endpoint-rest',
            regex: `(?:"|')([a-zA-Z0-9_\\-/]+\\/[a-zA-Z0-9_\\-/]{3,}(?:[?#][^"' ]*)?)(?:"|')`,
            description: 'REST API endpoints'
          },
          {
            id: 'endpoint-file',
            regex: `(?:"|')([a-zA-Z0-9_\\-]+\\.(?:php|asp|aspx|jsp|json|action|html|js|txt|xml)(?:[?#][^"' ]*)?)(?:"|')`,
            description: 'Standalone files'
          },
          {
            id: 'endpoint-template-literal',
            regex: '`((?:[^`]*\\$\\{[^}]+\\})+[a-zA-Z0-9_\\-/]*(?:\\/[a-zA-Z0-9_\\-/]*)*(?:[?#][^`]*)?)`',
            description: 'Template literal endpoints with ${} expressions'
          }
        ]
      }
      
      const secretTextGroup = {
        id: 'group-secrets',
        name: 'Secret Text',
        patterns: [
          // ===== Google Services =====
          { id: 's01', regex: 'AIza[0-9A-Za-z-_]{35}', description: 'Google API Key' },
          { id: 's02', regex: '(?i:(?:captcha|recaptcha|site[_\\-]?key|sitekey)[^a-zA-Z0-9]{0,50}(6L[0-9A-Za-z_-]{38}))', description: 'Google reCAPTCHA site key' },
          { id: 's03', regex: 'ya29\\.[0-9A-Za-z\\-_]+', description: 'Google OAuth token' },
          { id: 's04', regex: '[0-9]+-[0-9A-Za-z_]{32}\\.apps\\.googleusercontent\\.com', description: 'Google Cloud Platform OAuth' },
          // ===== Amazon AWS =====
          { id: 's05', regex: 'A[SK]IA[0-9A-Z]{16}', description: 'AWS Access Key ID' },
          { id: 's06', regex: 'amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', description: 'Amazon MWS Auth Token' },
          { id: 's07', regex: 's3\\.amazonaws\\.com[/]+|[a-zA-Z0-9_-]*\\.s3\\.amazonaws\\.com', description: 'Amazon AWS URL' },
          { id: 's08', regex: 'aws(.{0,20})?[\'"][0-9a-zA-Z/+]{40}[\'"]', description: 'Amazon AWS Secret Key' },
          { id: 's09', regex: '[a-z0-9.-]+\\.s3\\.amazonaws\\.com|s3://[a-z0-9.-]+|s3-[a-z0-9-]+\\.amazonaws\\.com', description: 'Amazon S3 Bucket' },
          { id: 's10', regex: '[a-z0-9]+\\.cloudfront\\.net', description: 'Amazon CloudFront URL' },
          // ===== Facebook =====
          { id: 's11', regex: 'EAACEdEose0cBA[0-9A-Za-z]+', description: 'Facebook Access Token' },
          { id: 's12', regex: '[fF][aA][cC][eE][bB][oO][oO][kK].*[\'"][0-9a-f]{32}[\'"]', description: 'Facebook OAuth' },
          // ===== Authorization Headers =====
          { id: 's13', regex: 'basic [a-zA-Z0-9=:_\\+/-]{5,100}', description: 'Authorization Basic' },
          { id: 's14', regex: 'bearer [a-zA-Z0-9_\\-.=:_\\+/]{5,100}', description: 'Authorization Bearer' },
          { id: 's15', regex: 'api[key|_key|\\s+]+[a-zA-Z0-9_\\-]{5,100}', description: 'Authorization API key' },
          // ===== Email Services =====
          { id: 's16', regex: 'key-[0-9a-zA-Z]{32}', description: 'Mailgun API Key' },
          { id: 's17', regex: '[0-9a-f]{32}-us[0-9]{1,2}', description: 'Mailchimp API Key' },
          { id: 's18', regex: 'SG\\.[0-9A-Za-z\\-_]{22}\\.[0-9A-Za-z\\-_]{43}', description: 'SendGrid API Key' },
          // ===== Communication Services =====
          { id: 's19', regex: 'SK[0-9a-fA-F]{32}', description: 'Twilio API Key' },
          { id: 's20', regex: '\\bAC[a-zA-Z0-9]{32}\\b', description: 'Twilio Account SID' },
          { id: 's21', regex: '\\bAP[a-zA-Z0-9]{32}\\b', description: 'Twilio App SID' },
          { id: 's22', regex: '"api_token":"(xox[a-zA-Z]-[a-zA-Z0-9-]+)"|xox[baprs]-([0-9a-zA-Z]{10,48})', description: 'Slack Token' },
          { id: 's23', regex: 'https://hooks\\.slack\\.com/services/T[a-zA-Z0-9_]{8}/B[a-zA-Z0-9_]{8}/[a-zA-Z0-9_]{24}', description: 'Slack Webhook' },
          { id: 's24', regex: 'https://discord\\.com/api/webhooks/[0-9]{18}/[a-zA-Z0-9_-]{68}', description: 'Discord Webhook' },
          { id: 's25', regex: '[MN][A-Za-z\\d]{23}\\.[\\w-]{6}\\.[\\w-]{27}', description: 'Discord Bot Token' },
          // ===== Payment Services =====
          { id: 's26', regex: 'access_token\\$production\\$[0-9a-z]{16}\\$[0-9a-f]{32}', description: 'PayPal Braintree Access Token' },
          { id: 's27', regex: 'sq0csp-[ 0-9A-Za-z\\-_]{43}|sq0[a-z]{3}-[0-9A-Za-z\\-_]{22,43}', description: 'Square OAuth Secret' },
          { id: 's28', regex: 'sqOatp-[0-9A-Za-z\\-_]{22}|EAAAEL[a-zA-Z0-9]{60}', description: 'Square Access Token' },
          { id: 's29', regex: 'sk_live_[0-9a-zA-Z]{24}', description: 'Stripe Standard API Key' },
          { id: 's30', regex: 'rk_live_[0-9a-zA-Z]{24}', description: 'Stripe Restricted API Key' },
          { id: 's31', regex: 'pk_live_[0-9a-zA-Z]{24}', description: 'Stripe Publishable Key' },
          { id: 's32', regex: 'access_token\\$sandbox\\$[0-9a-z]{16}\\$[0-9a-f]{32}', description: 'PayPal Sandbox Token' },
          // ===== GitHub & GitLab =====
          { id: 's33', regex: '[a-zA-Z0-9_-]*:[a-zA-Z0-9_\\-]+@github\\.com*', description: 'GitHub Access Token' },
          { id: 's34', regex: 'github_pat_[0-9a-zA-Z]{22}_[0-9a-zA-Z]{59}', description: 'GitHub OAuth Token' },
          { id: 's35', regex: '(ghu|ghs|ghr|ghp)_[0-9a-zA-Z]{36}', description: 'GitHub App Token' },
          { id: 's36', regex: 'ghr_[0-9a-zA-Z]{76}', description: 'GitHub Refresh Token' },
          { id: 's37', regex: 'glpat-[0-9a-zA-Z\\-_]{20}', description: 'GitLab Personal Access Token' },
          // ===== Cryptographic Keys =====
          { id: 's38', regex: '-----BEGIN RSA PRIVATE KEY-----', description: 'RSA Private Key' },
          { id: 's39', regex: '-----BEGIN DSA PRIVATE KEY-----', description: 'SSH DSA Private Key' },
          { id: 's40', regex: '-----BEGIN EC PRIVATE KEY-----', description: 'SSH EC Private Key' },
          { id: 's41', regex: '-----BEGIN PGP PRIVATE KEY BLOCK-----', description: 'PGP Private Key Block' },
          { id: 's42', regex: '-----BEGIN OPENSSH PRIVATE KEY-----', description: 'OpenSSH Private Key' },
          { id: 's43', regex: '-----BEGIN PRIVATE KEY-----', description: 'PKCS8 Private Key' },
          { id: 's44', regex: '-----BEGIN ENCRYPTED PRIVATE KEY-----', description: 'Encrypted Private Key' },
          // ===== Tokens & JWT =====
          { id: 's45', regex: 'ey[A-Za-z0-9-_=]+\\.[A-Za-z0-9-_=]+\\.?[A-Za-z0-9-_.+/=]*$', description: 'JSON Web Token (JWT)' },
          { id: 's46', regex: 'bearer\\s+[a-zA-Z0-9\\-._~+/]+=*', description: 'Bearer Token' },
          // ===== Database Connection Strings =====
          { id: 's47', regex: 'mysql://[a-zA-Z0-9_\\-]+:[a-zA-Z0-9_\\-!@#$%^&*()]+@[a-zA-Z0-9\\.\\-]+(?::[0-9]+)?/[a-zA-Z0-9_\\-]+', description: 'MySQL Connection String' },
          { id: 's48', regex: 'postgres(?:ql)?://[a-zA-Z0-9_\\-]+:[a-zA-Z0-9_\\-!@#$%^&*()]+@[a-zA-Z0-9\\.\\-]+(?::[0-9]+)?/[a-zA-Z0-9_\\-]+', description: 'PostgreSQL Connection String' },
          { id: 's49', regex: 'mongodb(?:\\+srv)?://[a-zA-Z0-9_\\-]+:[a-zA-Z0-9_\\-!@#$%^&*()]+@[a-zA-Z0-9\\.\\-:,/?=&]+', description: 'MongoDB Connection String' },
          { id: 's50', regex: '(?:Server|Data Source)=[a-zA-Z0-9\\.\\-,]+;(?:.*)?(?:Password|Pwd)=[^;]+', description: 'MSSQL Connection String' },
          { id: 's51', regex: 'redis://[a-zA-Z0-9_\\-]*:?[a-zA-Z0-9_\\-!@#$%^&*()]*@?[a-zA-Z0-9\\.\\-]+(?::[0-9]+)?(?:/[0-9]+)?', description: 'Redis Connection String' },
          { id: 's52', regex: '(?:jdbc|odbc):(?:mysql|postgres|oracle|sqlserver|mariadb)://[^\\s]+', description: 'Generic DB Connection (JDBC/ODBC)' },
          // ===== Cloud Services =====
          { id: 's53', regex: 'DefaultEndpointsProtocol=https;AccountName=[a-zA-Z0-9]+;AccountKey=[a-zA-Z0-9+/=]{88};', description: 'Azure Storage Account Key' },
          { id: 's54', regex: '(?i:(?:client[_\\-]?secret|clientsecret)\\s*[:=]\\s*["\']?([a-zA-Z0-9_~.\\-]{34,40})["\']?)', description: 'Azure Client Secret' },
          { id: 's55', regex: '[hH][eE][rR][oO][kK][uU].*[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}', description: 'Heroku API Key' },
          { id: 's56', regex: 'dop_v1_[a-f0-9]{64}', description: 'DigitalOcean Access Token' },
          { id: 's57', regex: 'doo_v1_[a-f0-9]{64}', description: 'DigitalOcean OAuth Token' },
          { id: 's58', regex: 'dor_v1_[a-f0-9]{64}', description: 'DigitalOcean Refresh Token' },
          // ===== API Keys & Secrets =====
          { id: 's59', regex: '(?i:(?:api[_-]?key|apikey|api[_-]?secret)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-]{20,})[\'"]?)', description: 'Generic API Key' },
          { id: 's60', regex: '(?i:(?:secret[_-]?key|secretkey)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-]{20,})[\'"]?)', description: 'Generic Secret Key' },
          { id: 's61', regex: '(?i:(?:access[_-]?token|accesstoken)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-\\.]{20,})[\'"]?)', description: 'Generic Access Token' },
          // ===== Messaging & Notification =====
          { id: 's62', regex: 'https://[a-z0-9-]+\\.firebaseio\\.com', description: 'Firebase Database URL' },
          { id: 's63', regex: '(?i:pusher[_\\-\\s]*(?:app[_\\-\\s]*)?(?:key|secret)\\s*[:=]\\s*[\'"]?([a-f0-9]{20})[\'"]?)', description: 'Pusher Key' },
          { id: 's64', regex: '(?i:pusher[_\\-\\s]*app[_\\-\\s]*id\\s*[:=]\\s*[\'"]?([0-9]{4,7})[\'"]?)', description: 'Pusher App ID' },
          // ===== Analytics & Tracking =====
          { id: 's65', regex: 'UA-[0-9]{4,9}-[0-9]{1,4}', description: 'Google Analytics (UA)' },
          { id: 's66', regex: 'G-[A-Z0-9]{10}', description: 'Google Analytics 4' },
          // ===== NPM & Package Managers =====
          { id: 's67', regex: 'npm_[a-zA-Z0-9]{36}', description: 'NPM Token' },
          { id: 's68', regex: 'pypi-AgEIcHlwaS5vcmc[A-Za-z0-9\\-_]{70,}', description: 'PyPI Token' },
          // ===== Authentication & OAuth =====
          { id: 's69', regex: '(?i:(?:client[_-]?id)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-\\.]{20,})[\'"]?)', description: 'OAuth Client ID' },
          { id: 's70', regex: '(?i:(?:client[_-]?secret)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-\\.]{20,})[\'"]?)', description: 'OAuth Client Secret' },
          // ===== Encryption & Hashing =====
          { id: 's71', regex: '(?i:(?:aes[_-]?key|encryption[_-]?key)[\\s]*[=:]\\s*[\'"]?([a-fA-F0-9]{32,})[\'"]?)', description: 'AES / Encryption Key' },
          { id: 's72', regex: '(?i:(?:jwt[_-]?secret)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-\\.]{20,})[\'"]?)', description: 'JWT Secret' },
          // ===== Credentials =====
          { id: 's73', regex: '(?i:(password\\s*[`=:"]+\\s*[^\\s]+|password is\\s*[`=:"]*\\s*[^\\s]+|pwd\\s*[`=:"]*\\s*[^\\s]+|passwd\\s*[`=:"]+\\s*[^\\s]+))', description: 'Possible Credentials' },
          { id: 's74', regex: '://[a-zA-Z0-9]+:[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]+', description: 'Basic Auth Credentials in URL' },
          { id: 's75', regex: '(?i:(?:username|user)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-\\.@]+)[\'"]?[\\s,;]*(?:password|pass|pwd)[\\s]*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-!@#$%^&*()]+)[\'"]?)', description: 'Username + Password pair' },
          // ===== Other Services =====
          { id: 's76', regex: 'pk\\.[a-zA-Z0-9]{60,}', description: 'Mapbox API Token' },
          { id: 's77', regex: '(?i:(algolia|application)_?key[\'\"\\s:=]+[a-zA-Z0-9]{10,})', description: 'Algolia API Key' },
          { id: 's78', regex: 'AKC[a-zA-Z0-9]{10,72}', description: 'Artifactory Token' },
          { id: 's79', regex: '(?i:(?:dd[_\\-]api[_\\-]key|datadog[_\\-]api[_\\-]key)\\s*[:=]\\s*[\'"]?([a-f0-9]{32})[\'"]?)', description: 'Datadog API Key' },
          { id: 's80', regex: '(?i:(?:dd[_\\-]app[_\\-]key|datadog[_\\-]app[_\\-]key)\\s*[:=]\\s*[\'"]?([a-f0-9]{40})[\'"]?)', description: 'Datadog App Key' },
          { id: 's81', regex: 'sl\\.[A-Za-z0-9\\-_]{135}', description: 'Dropbox API Token' },
          { id: 's82', regex: 'dt0c01\\.[A-Z0-9]{24}\\.[A-Z0-9]{64}', description: 'Dynatrace API Token' },
          { id: 's83', regex: 'NRAK-[A-Z0-9]{27}', description: 'New Relic API Key' },
          { id: 's84', regex: 'shpat_[a-fA-F0-9]{32}', description: 'Shopify Access Token' },
          { id: 's85', regex: 'shpca_[a-fA-F0-9]{32}', description: 'Shopify Custom Token' },
          { id: 's86', regex: 'shppa_[a-fA-F0-9]{32}', description: 'Shopify Private Token' },
          { id: 's87', regex: 'shpss_[a-fA-F0-9]{32}', description: 'Shopify Shared Secret' },
          { id: 's88', regex: '\\d{9}:[a-zA-Z0-9_-]{35}', description: 'Telegram Bot Token' },
          { id: 's89', regex: '(?i:twitter.*[1-9][0-9]+-[0-9a-zA-Z]{40})', description: 'Twitter Access Token' },
          { id: 's90', regex: 'A{22}[a-zA-Z0-9%]{80,}', description: 'Twitter Bearer Token' }
        ]
      };

      browser.storage.local.set({
        groups: [endpointsGroup, secretTextGroup],
        activeGroupId: endpointsGroup.id
      });
    }
  });
});
