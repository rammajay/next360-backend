import "dotenv/config";
import { app, ready } from "./app";

const PORT = process.env.PORT || 4000;

ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Next360 backend running on http://localhost:${PORT}`);
  });
});