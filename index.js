const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nrdgddr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // db collections
    const db = client.db("fureverHome");
    const userCollection = db.collection("users");
    const petCollection = db.collection("pets");
    const adoptReqCollection = db.collection("adoptRequests");
    const donationCampaignsCollection = db.collection("donationCampaigns");

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.post("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const isExist = await userCollection.findOne({
        userEmail: user?.userEmail,
      });
      if (isExist) return res.send("Already Exist");
      const result = await userCollection.insertOne(user);
      //welcome email for new users:
      //   sendMail(user?.email, {
      //     subject: "Welcome to StayVista",
      //     message: `Thank You for your interest on StayVista, Hope you will find your Destination. Have A good Time!`,
      //   });
      res.send(result);
    });

    // get all pets
    app.get("/pets", async (req, res) => {
      const result = await petCollection.find({ adopted: false }).toArray();
      res.send(result);
    });

    //get single cat
    app.get("/pet/:id", async (req, res) => {
      const id = req.params?.id;
      const query = { _id: new ObjectId(id) };
      const result = await petCollection.findOne(query);
      res.send(result);
    });

    //adoption request
    app.post("/adoptionRequests", async (req, res) => {
      const info = req?.body;
      const { petID, email } = info;
      const isExistReq = await adoptReqCollection.findOne({ petID, email });
      if (isExistReq)
        return res.send({ message: "Request Already Sent to Provider" });
      const result = await adoptReqCollection.insertOne(info);
      res.send(result);
    });

    //get all donation campaigns
    app.get("/donationCampaigns", async (req, res) => {
      const result = await donationCampaignsCollection
        .find()
        .sort({ lastDateOfDonation: -1 })
        .toArray();
      res.send(result);
    });

    //get single donation campaigns
    app.get("/donationCampaign/:id", async (req, res) => {
      const id = req.params?.id;
      const result = await donationCampaignsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from FureverHome Server..");
});

app.listen(port, () => {
  console.log(`FureverHome is running on port ${port}`);
});
