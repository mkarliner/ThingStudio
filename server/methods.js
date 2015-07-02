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
	}
});