const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const port = process.env.PORT || 5000;

// MIDDLEWARES
app.use(cors());
app.use(express.json());

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

    // APIs

    // menuCollection APIs
    // GET all menu items
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();

      res.send(result);
    });

    // reviewsCollection APIs
    // GET all reviewsCollection items
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();

      res.send(result);
    });

    // cartsCollection APIs
    // get all api
    app.get("/carts", async (req, res) => {
      const query = { userEmail: req.query.email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });

    // insert a carts item (itemId,userEmail,ItemName,ItemImage,price)
    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      // console.log(cartItem);
      const result = await cartsCollection.insertOne(cartItem);
      res.send(result);
      // res.send([])
    });
    //  delete single cart item
    app.delete("/carts/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email:email };
      // const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    // usersCollection APIs
    // (name,email)
    // GET all users API
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.status(200).send(result);
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
      const query = {_id:new ObjectId(id)};
      const result = await usersCollection.deleteOne(query);

      res.send(result);
      // res.send([])
    });

    // PATCH API: users
    app.patch('/users/:id',async(req,res)=>{
      const id=req.params.id 
      const query={_id:new ObjectId(id)}
      const {newRole}=req.body 
      const updatedData={
        $set:{
          role:newRole
        }
      }
      console.log("id, role=>",id,newRole);
      const result=await usersCollection.updateOne(query,updatedData)
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
