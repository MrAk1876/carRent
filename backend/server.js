import cors from 'cors';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const createApp = require('./app');

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: true });

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
app.use(
  cors({
    origin: ['http://localhost:5173', 'https://car-rent-qd40gmc0k-ayushkukadiya34-9020s-projects.vercel.app/'],
    credentials: true,
  }),
);
