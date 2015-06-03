HelpPages = new Mongo.Collection("help_pages");

// Schemas = {};

Schemas.HelpPage = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		max: 200
	},
	excerpt: {
		type: String,
		label: "Summary"
	},
	urlstring: {
		type: String,
		label: "URL String",
		max: 30,
		regEx: /^[-_a-z0-9]*$/i
	},
	pagenumber: {
		type: Number,
		label: "Page Number"
	},
	group: {
		type: String,
		label: "Group"
	},
	body: {
		type: String,
		label: "Body",
		optional: true,
		autoform: {
			rows: 30
		}
	},
	updatedAt: {
		type: Date,
		autoValue: function () {
			return new Date;
		},
		optional: true
	}
});

HelpPages.attachSchema(Schemas.HelpPage);

HelpPages.allow({
	insert: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	update: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	remove: function(userId, doc) {
		return (userId && doc.owner === userId);
	}
});