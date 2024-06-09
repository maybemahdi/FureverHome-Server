const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SK);

const nodemailer = require("nodemailer");

// middleware
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://fureverhome-970e1.web.app",
  ],
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

//nodemailer (send mail)
const sendMail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // Use `true` for port 465, `false` for all other ports
    auth: {
      user: process.env.TRANSPORTER_EMAIL,
      pass: process.env.TRANSPORTER_PASS,
    },
  });
  // verify connection configuration
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });

  //mail body
  const mailBody = {
    from: `"FureverHome" <${process.env.TRANSPORTER_EMAIL}>`,
    to: emailAddress,
    subject: emailData.subject,
    html: emailData.message,
  };

  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email Sent: " + info.response);
    }
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

    // middlewares
    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { userEmail: user?.email };
      const result = await userCollection.findOne(query);
      if (!result || result?.role !== "Admin") {
        return res.status(401).send({ message: "unauthorized access!!" });
      }
      next();
    };

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

    app.put("/users", async (req, res) => {
      const user = req.body;
      // console.log(user)
      const isExist = await userCollection.findOne({
        userEmail: user?.userEmail,
      });
      // console.log(isExist);
      if (isExist && isExist.userName !== null)
        return res.send("Already Exist");
      const updateDoc = {
        $set: {
          ...user,
        },
      };
      const filter = { userEmail: user?.userEmail };
      const options = { upsert: true };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      //welcome email for new users:
      sendMail(user?.userEmail, {
        subject: "Welcome to FureverHome",
        message: `Thank You for your interest on FureverHome, Hope you will enjoy our services. Have A good Time!`,
      });
      res.send(result);
    });

    // get all pets
    app.get("/pets", async (req, res) => {
      const category = req?.query?.category;
      const { per_page } = req?.query;
      const { search } = req.query;
      const { filter } = req.query;
      const query = {
        adopted: false,
        petName: { $regex: search, $options: "i" },
      };
      if (category !== "undefined") {
        query.petCategory =
          category.charAt(0).toUpperCase() + category.slice(1);
      }
      if (filter && filter !== "undefined") query.petCategory = filter;
      const result = await petCollection
        .find(query)
        .limit(parseFloat(per_page))
        .sort({ timestamp: -1 })
        .toArray();
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
      const { per_page } = req?.query;
      // console.log(per_page);
      const result = await donationCampaignsCollection
        .find()
        // .skip(parseFloat(page) * parseFloat(per_page))
        .limit(parseFloat(per_page))
        .sort({ timestamp: -1 })
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
      // send email to person who donated
      sendMail(donateInfo?.donarEmail, {
        subject: "Donation Successful!",
        message: `You've successfully Donated to a Campaign in FureverHome.
        Donated Amount: ${donateInfo?.donatedAmount}$
        Transaction Id: ${donateInfo?.transactionId}`,
      });

      //send email to person who asked for donations
      sendMail(donateInfo?.creator, {
        subject: "You just received a Donation!",
        message: `You've successfully received a donation for Pet Name: ${donateInfo?.petName},
        Donar Name: ${donateInfo?.donarName},
        Donar Email: ${donateInfo?.donarEmail}.
        Donated Amount: ${donateInfo?.donatedAmount}$
        Transaction Id: ${donateInfo?.transactionId}`,
      });

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

    //put pet update
    app.put("/pets/:id", verifyToken, verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const petData = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...petData,
        },
      };
      const result = await petCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //delete a pet
    app.delete("/pet/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const query = { _id: new ObjectId(id) };
      const result = await petCollection.deleteOne(query);
      res.send(result);
    });

    //update adopt status
    app.patch("/pet/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const { adopted } = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          adopted: adopted,
        },
      };
      const result = await petCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //create a campaign
    app.post("/campaigns", verifyToken, async (req, res) => {
      const petInfo = req?.body;
      const result = await donationCampaignsCollection.insertOne(petInfo);
      res.send(result);
    });

    //get created campaigns based on user
    app.get("/myCamp/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      const query = { creator: email };
      const result = await donationCampaignsCollection.find(query).toArray();
      res.send(result);
    });

    //get selected campaign for edit
    app.get("/campaign/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const query = { _id: new ObjectId(id) };
      const result = await donationCampaignsCollection.findOne(query);
      res.send(result);
    });

    //update user's created donation
    app.put("/campaigns/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const petData = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...petData,
        },
      };
      const result = await donationCampaignsCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    //pause campaign
    app.patch("/pauseCampaign/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const { status } = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await donationCampaignsCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    //resume campaign
    app.patch("/resumeCampaign/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const { status } = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await donationCampaignsCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    //get donation data for modal
    app.get("/donationData/:id", verifyToken, async (req, res) => {
      const id = req.params?.id;
      const donationsInfo = await donateCollection
        .find(
          { donateId: id },
          { projection: { donarName: 1, donarEmail: 1, donatedAmount: 1 } }
        )
        .toArray();
      res.send(donationsInfo);
    });

    //get donations(myDonation) based on user
    app.get("/myDonations/:email", verifyToken, async (req, res) => {
      const email = req.params?.email;
      const donations = await donateCollection
        .find(
          { donarEmail: email },
          {
            projection: {
              petImage: 1,
              petName: 1,
              donatedAmount: 1,
              donateId: 1,
            },
          }
        )
        .toArray();
      res.send(donations);
    });

    //refund and delete donate
    app.delete("/deleteDonate/:id", verifyToken, async (req, res) => {
      const id = req.params?.id;
      const query = { _id: new ObjectId(id) };
      const result = await donateCollection.deleteOne(query);
      res.send(result);
    });

    //update total donated amount
    app.patch("/updateTotalDonatedAmount/:id", async (req, res) => {
      // update donated amount
      const donateId = req?.params?.id;
      const { donatedAmount } = req?.body;
      const filter = { _id: new ObjectId(donateId) };
      const itemForPatch = await donationCampaignsCollection.findOne(
        filter,
        { projection: { donatedAmount: 1 } }
      );
      // console.log(donateId);
      const updateDoc = {
        $set: {
          donatedAmount: itemForPatch.donatedAmount - donatedAmount,
        },
      };
      const result = await donationCampaignsCollection.updateOne(filter, updateDoc);
      res.send(result)
    });

    //get user's adoption requests on their pet
    app.get("/myAdoptionRequests/:email", verifyToken, async (req, res) => {
      const email = req.params?.email;
      const query = { provider: email };
      const reqInfo = await adoptReqCollection
        .find(query, {
          projection: {
            petName: 1,
            petImage: 1,
            petID: 1,
            name: 1,
            adopted: 1,
            email: 1,
            phone: 1,
            address: 1,
            status: 1,
          },
        })
        .toArray();
      res.send(reqInfo);
    });

    //update adopted status
    app.patch("/updateAdoptedStatus", verifyToken, async (req, res) => {
      const { id } = req?.body;
      const { petID } = req?.body;
      const updateDoc = {
        $set: {
          adopted: true,
        },
      };
      const pet = await petCollection.updateOne(
        {
          _id: new ObjectId(petID),
        },
        updateDoc
      );
      const adoptReq = await adoptReqCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        updateDoc
      );
      res.send({ pet, adoptReq });
    });

    //reject adopt req
    app.patch("/rejectAdoptReq/:id", async (req, res) => {
      const id = req?.params?.id;
      const { status } = req?.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await adoptReqCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //get all users for admin
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //make admin feature
    app.patch("/user/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params?.email;
      const filter = { userEmail: email };
      const updateDoc = {
        $set: {
          role: "Admin",
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //get all pets
    app.get("/allPets", verifyToken, verifyAdmin, async (req, res) => {
      const result = await petCollection.find().toArray();
      res.send(result);
    });

    //get all donations
    app.get("/campaigns", verifyToken, verifyAdmin, async (req, res) => {
      const result = await donationCampaignsCollection.find().toArray();
      res.send(result);
    });

    //delete a donation campaign
    app.delete("/campaign/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params?.id;
      const query = { _id: new ObjectId(id) };
      const result = await donationCampaignsCollection.deleteOne(query);
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
