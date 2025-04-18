const express = require("express");
const app = express();
const axios=require('axios')
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;
// payment gateway
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Mailgun mailer
const formData = require("form-data");
const Mailgun = require("mailgun.js");
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY,
});

// MIDDLEWARES
app.use(cors({origin:['https://bistro-boss-restaurant-2e856.web.app','https://bistro-boss-restaurant-2e856.firebaseapp.com']}));
app.use(express.json());

// custom middleware
const verifyToken = (req, res, next) => {
  // console.log("inside verifytoken=>", req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access!" });
  }

  const token = req.headers.authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ msg: "unauthorized access" });
    }

    // console.log("Decoded=>>>",decoded);

    req.decoded = decoded;
    next();
  });
};

// mongodb connection
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uomr8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // DB+Collections
    const menuCollection = client.db("bistroBossDB").collection("menu");
    const reviewsCollection = client.db("bistroBossDB").collection("reviews");
    const cartsCollection = client.db("bistroBossDB").collection("carts");
    const usersCollection = client.db("bistroBossDB").collection("users");
    const paymentsCollection = client.db("bistroBossDB").collection("payments");
    const reservationsCollection = client.db("bistroBossDB").collection("reservations");
    const contactMsgsCollection = client.db("bistroBossDB").collection("contactMsgs");

    // verifyAdmin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };

      const user = await usersCollection.findOne(query);

      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        // console.log("Get out , you notAdmin begger");
        return res.status(403).send({ msg: "forbidden access" });
      }

      next();
    };

    // APIs

    // jwt apis
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "24h",
      });

      res.send({ token });
    });

    // Admin-stats

    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const usersStat = await usersCollection.estimatedDocumentCount();
      const reviewsStat = await reviewsCollection.estimatedDocumentCount();
      const menuStat = await menuCollection.estimatedDocumentCount();
      const paymentsStat = await paymentsCollection.estimatedDocumentCount();
      const revenueStat = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: {
                  $toDouble: "$price",
                }
              },
            },
          },
        ])
        .toArray();

      // console.log("revenueStat=>", revenueStat);
      const revenue =
        revenueStat.length > 0 ? revenueStat[0].totalRevenue.toFixed(2) : 0;
      res.send([revenue, usersStat, menuStat, paymentsStat, reviewsStat]);
      // res.send({usersStat,reviewsStat,menuStat,paymentsStat,revenue})
    });

    // /user-stats API
    app.get("/user-stats/:email", async (req, res) => {
      const email = req.params.email;
      const name=req.query.name
      const orderQuery = { userEmail: email };
      const query = { email: email };
      const reviewQuery={name:name}
      // console.log("user-stats query=>", query);
      const reviewsCount = await reviewsCollection.countDocuments(reviewQuery);
      const ordersCountInCart = await cartsCollection.countDocuments(
        orderQuery
      );
      const paymentsCount = await paymentsCollection.countDocuments(query);
      const ordersCount = paymentsCount;

      const totalMoneySpent = await paymentsCollection
        .aggregate([
          {
            $match: {
              email: email,
            },
          },
          {
            $group: {
              _id: null,
              totalSpent: {
                $sum: {
                  $toDouble: "$price",
                },
              },
            },
          },
        ])
        .toArray();

      // console.log("totalMoneySpent==>",totalMoneySpent);

      const totalSpent = totalMoneySpent.reduce(
        (sum, item) => sum + item.totalSpent,
        0
      );

      res.send([
        totalSpent,
        ordersCount,
        reviewsCount,
        paymentsCount,
        ordersCountInCart,
      ]);
    });

    // order-stats
    app.get("/order-stats", async (req, res) => {
      const result = await paymentsCollection
        .aggregate([
          {
            $unwind: "$menuItemIds",
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuItemIds",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              quantity: {
                $sum: 1,
              },
              revenue: { $sum: "$menuItems.price" },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              quantity: "$quantity",
              revenue: "$revenue",
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    // PAYMENT GATEWAY API
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      // console.log("amount==>", amount);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // PaymentCollection
    // GET API
    app.get("/payments/:email", async (req, res) => {
      const query = { email: req.params.email };
      // TODO: in review page-> fetch all prev purchased items
      // const purchasedItems=req.query.purchasedItems
      // console.log(purchasedItems,typeof purchasedItems);
      // console.log(query);
      let result = await paymentsCollection.find(query).sort({date:-1}).toArray();

      // if(purchasedItems)
      // {
      //   const menuQuery={_id:{
      //     $in:result.menuItemIds
      //   }}
      //   result=await menuCollection.find(menuQuery).toArray()
      // }
      // console.log(result);
      res.send(result);
    });

    // POST API: paymentCollection
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      // console.log("payment",payment);
      const paymentResult = await paymentsCollection.insertOne(payment);

      // send mail using MAILGUN

      // mg.messages
      //   .create("sandbox-123.mailgun.org", {
      //     from: `Excited User <mailgun@${process.env.MAILGUN_DOMAIN_EMAIL}>`,
      //     to: ["sazolsarker1@gmail.com"],
      //     subject: "Foods order payment received!",
      //     text: "Thanks for choosing us.",
      //     html: "<h1></h1>",
      //   })
      mg.messages
        .create(process.env.MAILGUN_DOMAIN_EMAIL, {
          from: `Bistro Boss Restaurant <mailgun@${process.env.MAILGUN_DOMAIN_EMAIL}>`,
          to: ["sazolsarker1@gmail.com"],
          subject: "Payment Confirmation – Thanks for Your Food Order!",
          text: `Hi there,
We’ve received your payment successfully. Thank you for ordering with us!

Your delicious food is being prepared and will be on its way soon.

If you have any questions or special requests, feel free to reply to this email.

Bon appétit!
– The Bistro Boss Restaurant Team`,
          html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Thank you for your <b>$ ${payment.price}</b> payment!</h2>
        <p>Hi there,</p>
        <p>We’ve successfully received your payment and are now preparing your order.</p>
        <p>Our team is making sure everything is perfect, and your food will be on the way shortly!</p>
        <p>If you have any questions, feel free to reply to this email.</p>
        <br />
        <p>Bon appétit! <br />– The <strong>Bistro Boss Restaurant</strong> Team</p>
      </div>
    `,
        })

        .then((msg) => console.log(msg)) // logs response data
        .catch((err) => console.error(err)); // logs any error

      // res.send(paymentResult)

      // carefully delete item from cart
      // not working or refetch not working on client
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };

      const deleteResult = await cartsCollection.deleteMany(query);

      res.send({ paymentResult, deleteResult });
    });

    // menuCollection APIs
    // GET all menu items
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();

      res.send(result);
    });

    // GET a menu item API
    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      // console.log("menu item id=>>",id);
      // console.log("GET /menu/:id HIT");
      const query = { _id: id };
      // const query={_id:new ObjectId(id) }
      const result = await menuCollection.findOne(query);

      // console.log("result=>", result);
     
      res.send(result);
    });

    // POST a new menu item
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const newFood = req.body;
      const result = await menuCollection.insertOne(newFood);

      res.send(result);
    });

    // DELETE API: a food item
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    // PATCH API: partial update a menu item
    app.patch("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const foodItem = req.body;
      const updatedItem = {
        $set: {
          name: foodItem.name,
          recipe: foodItem.recipe,
          category: foodItem.category,
          price: foodItem.price,
        },
      };
      // console.log("foodItem==", foodItem);

      const result = await menuCollection.updateOne(query, updatedItem);

      res.status(200).send(result);
    });

    // reviewsCollection APIs
    // GET all reviewsCollection items
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().sort({rating:-1}).toArray();

      res.send(result);
    });

    // post a review in DB***-----
    app.post('/reviews',async(req,res)=>{
      const data=req.body
      const newReview={
        name:req.body.name,
        details:req.body.details,
        rating:req.body.rating,
      }
      
    
      const result=await reviewsCollection.insertOne(newReview)

      res.send(result)
    
    })

    // cartsCollection APIs
    // get all api
    app.get("/carts", verifyToken, async (req, res) => {
      const query = { userEmail: req.query.email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });


    // insert a carts item (itemId,userEmail,ItemName,ItemImage,price)
    app.post("/carts", verifyToken, async (req, res) => {
      const cartItem = req.body;
      // console.log(cartItem);
      const result = await cartsCollection.insertOne(cartItem);
      res.send(result);
    });
    //  delete single cart item
    app.delete("/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    // usersCollection APIs
    // (name,email)
    // GET all users API
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      // console.log("REQ headers:->", req.headers);
      const result = await usersCollection.find().toArray();
      res.status(200).send(result);
    });

    // GET API: check user role:admin/user
    app.get("/users/:email",verifyToken, async (req, res) => {
      const email = req.params.email;
      // console.log("email -- decoded email==> ",email,req.decoded.email);

      //real user or intruder checking info of other user
      if (email !== req.decoded.email) {
        return res.status(401).send({ msg: "forbidden" });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);

      let admin = false;
      if (user) {
        admin = user.role === "admin";
      }

      res.send({ admin });
    });

    // POST- create new user
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const query = { email: newUser.email };
      // console.log(newUser);

      // const userExist=await usersCollection.find(query)
      // console.log(userExist);
      // if(userExist)
      //   return res.status(400).send({msg:"User already exist!"})

      const result = await usersCollection.insertOne(newUser);
      res.status(201).send(result);
      // res.send([])
    });

    // DELETE API: users
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      // console.log("id=>",id);
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);

      res.send(result);
      // res.send([])
    });

    // PATCH API: users
    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const { newRole } = req.body;
      const updatedData = {
        $set: {
          role: newRole,
        },
      };
      // console.log("id, role=>", id, newRole);
      const result = await usersCollection.updateOne(query, updatedData);
      res.send(result);
    });

    //  APIS: reservationsCollection
    // POST API: single
    app.post('/reservations',async(req,res)=>{
      const newReservation=req.body 

      const result=await reservationsCollection.insertOne(newReservation)

      res.send(result)
    })

    //PATCH API: reservation 
    app.patch('/reservations/:id',async(req,res)=>{
      const id=req.params.id
      const isConfirmed=req.body.isConfirmed

      const query={_id:new ObjectId(id)}

      const updatedData={
        $set:{
          status:`${isConfirmed?"confirmed":"cancelled"}`
        }
      }

      const result=await reservationsCollection.updateOne(query,updatedData)

      res.send(result)
    })

    // GET API: ALL for admin dashboard
    app.get('/reservations',async(req,res)=>{
     

      const result=await reservationsCollection.find().toArray()

      res.send(result)
    })

    // GET API: all by email
    app.get('/reservations/:email',async(req,res)=>{
      const email=req.params.email 
      const query={reservationEmail:email}

      const result=await reservationsCollection.find(query).toArray()

      res.send(result)
    })

    // DELETE API: single reservation
    app.delete('/reservations/:id',async(req,res)=>{
      const id=req.params.id 
      // console.log(id);
      const query={_id:new ObjectId(id)}
      const result=await reservationsCollection.deleteOne(query)

      res.send(result)
    })

    // // contactUs API : check recaptcha V2, send email/store to DB
    // app.post('/contactUs',async(req,res)=>{
    //   const contactData=req.body 
    //   console.log(contactData);
    //   // ReCaptcha verify
    //   const response=contactData.token 
    //   const secret=process.env.RECAPTCHA_V2_API_KEY

    //   const captchaRes=await axios.post('https://www.google.com/recaptcha/api/siteverify',null,{params:{secret,response}})
      
    //   if(captchaRes.data.success){
    //     // process the ContactData
    //     console.log("Captcha correct!");
    //   }



    //   res.send([{msg:'captcha ok'}])

    // })

    app.post('/contactUs', async (req, res) => {
      const contactData = req.body;
      // console.log("contactData==>",contactData);
      const response = contactData.token;
      const secret = process.env.RECAPTCHA_V2_API_KEY;
    
      try {
        // ReCAPTCHA verify
        const captchaRes = await axios.post(
          'https://www.google.com/recaptcha/api/siteverify',
          null,
          {
            params: {
              secret,
              response,
            },
          }
        );
    
        if (captchaRes.data.success) {
          // console.log("✅ Captcha correct!");
          // Process contactData (e.g., send email/store in DB)

          // POST API: contactMsgsCollection
          const newContactMsg={
            name:contactData.contactorName,
            email:contactData.contactorEmail,
            phone:contactData.contactorPhoneNo,
            msg:contactData.review
          }
          const contactRes=await contactMsgsCollection.insertOne(newContactMsg)

          return res.status(200).send(contactRes);
        } else {
          // console.log("❌ Captcha failed:", captchaRes.data['error-codes']);
          return res.status(403).json({ msg: 'Invalid captcha' });
        }
      } catch (error) {
        // console.error("❌ reCAPTCHA verification error:", error.message);
        return res.status(500).json({ msg: 'Captcha verification failed' });
      }
    });

    // GET API: contactMsg
    app.get('/contactMsg',async(req,res)=>{
      const result=await contactMsgsCollection.find().toArray()
      res.send(result)
    })
    

    // **************************

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Boss is watching...");
});

app.listen(port, () => {
  console.log("app is running at port=>", port);
});


