Widgets = new Mongo.Collection("widgets");



Schemas.WidgetParameter = new SimpleSchema({
	title: {
		type: String
	},
	paramType: {
		label: "Type",
		type: String,
		// allowedValues: ["Number", "[Numbers]", "String"],
		autoform: {
			type: "selectize",
			options: function(){
				options = [{label: "Number", value: "Number"}, {label: "Array of Numbers", value: "[Numbers]"}, {label: "String", value: "String"}, {label: "Feed", value: "Feed"}];
				return (options);
			}
		}
	},
	required: {
		type: Boolean,
		defaultValue: false,
		autoform: {
			afFieldInput: {
				type: 'boolean-checkbox-M',
				class: 'filled-in'
			}
		}
	},
	description: {
		type: String
	},
	dummyValue: {
		type: String,
		optional: true
	}
})

Schemas.Widget = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		max: 200
	},
	owner: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
		autoValue: function(){
			if(this.isInsert) {
				return Meteor.userId();
			} else if(this.isUpsert) {
				return {$setOnInsert: Meteor.userId};
			} else {
				this.unset();
			}
		}
	},
	appId: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
	},
	baseScreen: {
		type: String,
		autoform: {
			type: "selectize", 
			options: function(){
				scrs = Screens.find({}, {title: 1}).fetch();
				options = scrs.map(function(ele, idx, arry){
					return {label: ele.title, value: ele._id}
				})
				// console.log("SCR OPTIONS ", options)
				return options;
			}
		}
	},
	widgetType: {
		type: String,
		allowedValues: ["Web Component", "Library Template"],
		defaultValue: "Web Component",
		autoform: {
			type: "selectize",
			options: function(){
				options = [{label: "Web Component", value: "Web Component"}, {label: "Library Template", value: "Library Template"}];
				return (options);
			}
		}
	},
	tagName: {
		type: String,
		regEx: /^[a-zA-Z_]+-[a-zA-Z_]+$/,
		optional: true
	},
	instructions: {
		type: String,
		optional: true,
		autoform: {
			rows: 10
		}
	},
	parameters: {
		type: [Schemas.WidgetParameter],
		optional: true,
		autoform: {
			minCount: 0,
			initialCount: 0
		}
	}
	// public: {
	// 	type: Boolean,
	// 	defaultValue: false
	// }
//
	
});

Widgets.before.insert(function(userId, doc) {
	if(Meteor.isClient) {
		// console.log("BEFOREHOOK ", userId, doc, Session.get("currentApp"));
		doc.appId = Session.get("currentApp")._id;
	}
});

Widgets.after.update(function(userId, doc) {
	if(Meteor.isClient){
		console.log("Widget update", userId, doc, this)

		try {
			scr = Screens.findOne(doc.baseScreen);
			name = scr.title;
			delete Template[name]; //Remove the existing template instance.
			compret = compileTemplate(name, scr.html, scr.js);
			Alerts.insert(compret);
			console.log("Registering widget: "+doc.tagName)
			Template[scr.title].registerElement(doc.tagName);
		}
		catch(err) {
			console.log("Problem registering element: ", doc.tagName);
		}
	}
});

Widgets.attachSchema(Schemas.Widget);

Widgets.allow({
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


