Template.ViewUserBody.onRendered(function(){
    console.log("VU: ", this)
    Meteor.call("userDetails", this.data, function(error, result){
        console.log("REVU", result)
        Session.set("UserDetails", result);
    })
});


Template.ViewUserBody.helpers({
    userDetails: function(){
        return Session.get("UserDetails");
    },
    email: function(){
        return Session.get("UserDetails").user.emails[0].address;
    },
    test: function(){
        console.log("TEST: ", this)
    },
	syslogs: function(){
		types = ["ScreenUpdate", "New User", "UserAction", "TemplateView", "AppRemove"];	
        u = Session.get("UserDetails").user;
		sl =  SysLogs.find({userName: u.username, event: {$in: types}}, {sort: {date: -1}}).fetch();
        console.log("SL: ", u.username,  sl)
        return sl;
	},
})


Template.ViewUserBody.events({
	'click .select-app': function(ev) {
		console.log("APPCL ", ev, this)
		ev.preventDefault();
		Meteor.subscribe("apps", this._id);
	}
})