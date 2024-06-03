const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SK);

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
  // console.log(token);
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
    const donateCollection = db.collection("donations");

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
      const category = req?.query?.category;
      const query = { adopted: false };
      if (category !== "undefined") {
        query.petCategory = category.charAt(0).toUpperCase() + category.slice(1);
      }
      const result = await petCollection.find(query).toArray();
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
    app.post("/adoptionRequests", verifyToken, async (req, res) => {
      const info = req?.body;
      const { petID, email } = info;
      const isExistReq = await adoptReqCollection.findOne({ petID, email });
      if (isExistReq)
        return res.send({ message: "Request Already Sent to Provider" });
      const result = await adoptReqCollection.insertOne(info);
      res.send(result);
    });

    //get all donation campaigns
    app.get("/donationCampaigns", verifyToken, async (req, res) => {
      const result = await donationCampaignsCollection
        .find()
        .sort({ lastDateOfDonation: -1 })
        .toArray();
      res.send(result);
    });

    //get single donation campaigns
    app.get("/donationCampaign/:id", verifyToken, async (req, res) => {
      const id = req.params?.id;
      const result = await donationCampaignsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //get payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const amount = req?.body?.amount;
      const amountInCent = parseFloat(amount) * 100;
      // console.log(amountInCent)
      // Create a PaymentIntent with the order amount and currency
      const { client_secret } = await stripe.paymentIntents.create({
        amount: amountInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      });
      // console.log(client_secret)
      res.send({ clientSecret: client_secret });
    });

    //post donated info in donateCollection
    app.post("/donate", verifyToken, async (req, res) => {
      const donateInfo = req.body;
      // console.log(donateInfo)
      const result = await donateCollection.insertOne(donateInfo);
      res.send(result);
    });

    //patch totalDonate in campaigns collection
    app.patch("/updateTotalDonation/:id", verifyToken, async (req, res) => {
      const { id } = req?.params;
      const { donatedAmount } = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          donatedAmount: donatedAmount,
        },
      };
      const result = await donationCampaignsCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    //get user role
    app.get("/role/:email", verifyToken, async (req, res) => {
      const { email } = req?.params;
      const { role } = await userCollection.findOne({ userEmail: email });
      res.send(role);
    });

    //post a pet data to pet collection
    app.post("/pets", verifyToken, async (req, res) => {
      const petData = req?.body;
      const result = await petCollection.insertOne(petData);
      res.send(result);
    });

    //get added pets based on user
    app.get("/pets/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      const result = await petCollection.find({ provider: email }).toArray();
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
