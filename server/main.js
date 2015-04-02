

  Meteor.startup(function () {
    // code to run on server at startup
	 // console.log(Connections.find({}).fetch());
	  
	  
	  
	  Meteor.publish("connections", function(){
		  if(this.userId) {
	  	  	c = Connections.find({$or: [{owner: this.userId}]});
		  } else {
  	  	  	c = Connections.find({public: true});
		  }
		  return c;
	  });

	  Meteor.publish("screens", function(){
	  	return Screens.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("feeds", function(){
	  	return Feeds.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("themes", function(){
	  	return Themes.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("help_pages", function(){
	  	return HelpPages.find({}, {sort: {pagenumber: 1}});
	  });
	  Meteor.publish("userData", function () {
		  user = Meteor.users.find({_id: this.userId});
		  if(user.roles && user.roles['admin']) {
		  	return Meteor.users.find({});
		  } else {
			 this.ready();
		  }
	  });
	  
	  Meteor.publish("userStatus", function() {
		  user = Meteor.users.findOne({_id: this.userId});
		  if(user &&  user.roles && user.roles.indexOf('admin')> -1) {
		  	 return Meteor.users.find({ "status.online": true }, { fields: { status: 1, username: 1 } });
		  } else {
			 this.ready();
		  }
	    
	  });
	  
	  Meteor.publish("userList", function() {
		  user = Meteor.users.findOne({_id: this.userId});
		  //console.log("ADM : ", user);
		  if(user && user.roles && user.roles.indexOf('admin')> -1) {
			  //console.log("ALLUSERS");
		  	 return Meteor.users.find({  }, { fields: { status: 1, username: 1 } });
		  } else {
			  //console.log("ONEUSER")
			 this.ready();
		  }
	  })
	  
	  Meteor.publish("adminStatus", function() {
	  	 return Meteor.users.find({roles: "admin", "status.online": true}, { fields: { status: 1, username: 1 } })
	  });
	  
	  
	  

  });

