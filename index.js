const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

// MIDDLEWARES
app.use(cors());
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

    // verifyAdmin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };

      const user = await usersCollection.findOne(query);

      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        console.log("Get out , you notAdmin begger");
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
      console.log("GET /menu/:id HIT");
      const query = { _id: id };
      // const query={_id:new ObjectId(id) }
      const result = await menuCollection.findOne(query);

      console.log("result=>", result);
      // res.send([])
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

      const result=await menuCollection.updateOne(query,updatedItem)

      res.status(200).send(result);
    });

    // reviewsCollection APIs
    // GET all reviewsCollection items
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();

      res.send(result);
    });

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
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

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
