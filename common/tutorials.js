Tutorials = new Meteor.Collection("tutorials");

Schemas.Tutorials = new SimpleSchema({
	title: {
		type: String
	},
  url: {
    type: String
  },
  urlstring: {
    type: String
  },
	summary: {
		type: String
	}
})

Tutorials.allow({
	insert: function(userId, doc) {
		return true;
	},
	update: function(userId, doc) {
		return false;
	},
	remove: function(userId, doc) {
		return false;
	}
});
