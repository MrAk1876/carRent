const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const createApp = require("./app");

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: true });

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
