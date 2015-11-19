Apps = new Mongo.Collection("apps");

Schemas = {};

Schemas.App = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		max: 200
	},
	summary: {
		type: String,
		label: "Summary",
		optional: true
	},
	description: {
		type: String,
		label: "Description",
		optional: true,
		autoform: {
			rows: 6
		}
	},
	home_page: {
		type: String,
		optional: true,
		autoform: {
			type: 'selectize',
			afFormGroup: {
				'formgroup-class': 'field-dropdown'
			},
			options: function(){
				scrs = Screens.find({isWidget: false}, {title: 1}).fetch();
				options = scrs.map(function(ele, idx, arry){
					return {label: ele.title, value: ele._id}
				})
				//console.log("SCR OPTIONS ", options)
				return options;
			}
		}
	},
	ancestor: {
		type: String,
		label: "Parent App",
		index: 1,
		optional: true,
		autoform: {
			type: "selectize",
			options: function(){
				apps = Apps.find({}).fetch();
				options = [];
				var i;
				for(i=0; i<apps.length; i++) {
					options[i] = { label: apps[i].title, value: apps[i]._id};
				}
				return(options);
			}
		}
	},
	connection: {
		type: String,
		optional: true,
		index: true,
		autoform: {
			type: "selectize",
			afFormGroup: {
				'formgroup-class': 'field-dropdown'
			},
			options: function(){
				connections = Connections.find({}).fetch();
				options = [];
				options.push({label: "No connection", value: "none"});
				var i;
				for(i=0; i<connections.length; i++) {
					options.push({ label: connections[i].title, value: connections[i]._id});
				}
				return(options);
			}
		}
	},
	theme: {
		type: String,
		optional: true,
		autoform: {
			type: "selectize",
			options: function(){
				themes = Themes.find({}).fetch();
				options = [];
				var i;
				for(i=0; i<themes.length; i++) {
					options[i] = { label: themes[i].title, value: themes[i]._id};
				}
				return(options);
			}
		}
	},
	owner: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
		autoValue: function(thing){
			if(this.isInsert) {
				return Meteor.userId();
			} else if(this.isUpsert) {
				return {$setOnInsert: Meteor.userId};
			} else {
				this.unset();
			}
		}
	},
	// access: {
	// 	type: String,
	// 	defaultValue: "Private",
	// 	allowedValues: ["Private", "Shareable", "Published"],
	// 	autoform: {
	// 		afFieldInput: {
	// 			type: 'select-radio-inline-M',
	// 			class: 'with-gap' // optional
	// 			// summernote options goes here
	// 		}
	// 	}
	// },
	shareable: {
		type: Boolean,
		label: "Shareable: Accessible via anybody with app URL",
		defaultValue: false
	},
	public: {
		type: Boolean,
		label: "Public: Include in global list of apps",
		defaultValue: false,
	},
	js: {
		optional: true,
		label: "Javascript",
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'aceappjs',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		},
		defaultValue: "//Advanced Use Only"
	},
	css: {
		optional: true,
		label: "CSS",
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'aceappcss',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		},
		defaultValue: "/* Add App-level CSS here */"
	},
	documentation: {
		optional: true,
		label: "Documentation",
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'aceappdoc',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		},
		defaultValue: "#Documentation in markdown here"
	},
	showHamburger: {
		type: Boolean,
		label: "Show Nav Menu in App Header",
		defaultValue: true,
		optional: true
	}
	// inAppStore: {
	// 	type: Boolean,
	// 	defaultValue: false
	// }

});

Apps.before.remove(function(userId, doc) {
	if(Meteor.isServer) {
		//check for dependent apps.
		if(Apps.findOne({ancestor: doc._id})) {
			return false;
		}
		SysLogs.insert({
			event: "AppRemove",
			title: doc.title,
			id: doc._id,
			userName: Meteor.users.findOne({_id: doc.owner}).username,
			details: "",
			date: new Date()
		});
		//console.log("APP DESTROY");
		Connections.remove({appId: doc._id});
		Feeds.remove({appId: doc._id});
		Screens.remove({appId: doc._id});
		Themes.remove({appId: doc._id});
	}
});



Apps.after.insert(function(userId, doc) {
	if(Meteor.isClient) {
		changeActiveApp(doc._id);
		Router.go('Edit App', {_id: doc._id});
	}
});

Apps.after.update(function(userId, doc) {
	if(Meteor.isClient) {
		InitialiseApps();
		currConn = getCurrentConnection();
		if(currConn && currConn._id != doc.connection) {
			newConn = Connections.findOne({_id: doc.connection});
			UnsubscribeAll();
			DisconnectMQTT();
			setCurrentConnection(false);
			Session.set("authReady", false);
			ResetMessages();
			connect(newConn); //App update
		}
	}
});

Apps.attachSchema(Schemas.App);

Apps.allow({
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
