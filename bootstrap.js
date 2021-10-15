const child_process = require("child_process");
child_process.execSync("yarn", { stdio: "inherit", cwd: __dirname });

require("./index");
