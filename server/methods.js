Meteor.methods({
	foreignConnections: function(){
		if(isAdmin(this.userId)) {
			c  =	Connections.find({$and: [{host: {$ne: "mqtt.thingstud.io"}}, {host: {$ne: "mqtt.modern-industry.com"}}]}).fetch();
			// console.log("FC: ", c)
			return c;
		}
	},
	screenDetails: function(id){
		if(isAdmin(this.userId)) {
			s = Screens.findOne({_id: id});
			if(s) {
				s.user = Users.findOne({_id: s.owner})
			}
			
			// console.log("FC: ", c)
			return s;
		}
	},
	templateView: function(id) {
		doc = Screens.findOne({_id: id});
		owner = Meteor.users.findOne({_id: doc.owner});
		console.log("template view ", doc, owner)
		
		SysLogs.upsert({event: "TemplateView", id: doc._id},
		{$set: 
				{
					event: "TemplateView",
					title: doc.title,
					date: new Date(),
					id: doc._id,
					appId: doc.appId,
					owner: doc.owner,
					details: "Author: " + owner.username
				},
			$inc: 
				{
					count: 1
				}
			})
	},
    sendShareLink: function (to, appId) {
		if(!this.userId) {
			console.log("Invalid user for email method!");
			return;
		}
      check([to, from, subject, text, appId], [String]);
	  app = Apps.findOne({_id: appId});
	  if(!app) {
	  	console.log("Failed to find email shared app", appId)
		  return;
	  }
      // Let other method calls from the same client start running,
      // without waiting for the email sending to complete.
      this.unblock();
	  domain = Meteor.settings.public.domain;
	  url = "http://domain" + "/view/app/" + appId;
	  link = "<a href=\""+url+">\"";
      Email.send({
        to: to,
        from: "noreply@thingstud.io",
        subject: "You've been sent a ThingStudio Application link",
		  text: "Click " + link + "here</a> to access your app"
      });
    }
});


