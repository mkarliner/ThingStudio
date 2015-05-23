Credentials = new Ground.Collection('credentials', {connection: null});


Schemas.Credentials = new SimpleSchema({
    username: {
        type: String,
        label: "Username",
        max: 50
    },
    password: {
        type: String,
    },
    save: {
        type: Boolean,
        label: "Save?",
    }
});