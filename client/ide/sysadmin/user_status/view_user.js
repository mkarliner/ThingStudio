Template.ViewUserBody.onRendered(function(){
    Meteor.call("userDetails", this.data, function(error, result){
        Session.set("UserDetails", result);
    })
  	$('ul.tabs').tabs();

});


Template.ViewUserHeader.helpers({
    userDetails: function() {
      return Session.get("UserDetails")
    },
    email: function() {
      return Session.get("UserDetails").user.emails[0].address
    },
    since: function () {
      since = Meteor.users.findOne({_id: this.user._id}).createdAt
      return moment(since).format('MMMM D, YYYY, hh:mm:ss a' )
    }
})

Template.ViewUserBody.helpers({
  userDetails: function() {
    return Session.get("UserDetails")
  },
  syslogs: function() {
		types = ["ScreenUpdate", "New User", "PageView", "TemplateView", "AppRemove"]
    u = Session.get("UserDetails").user
		sl =  SysLogs.find({userName: u.username, event: {$in: types}}, {sort: {date: -1}}).fetch()
    return sl;
	}
})


Template.ViewUserBody.events({
	'click .select-app': function(ev) {
		ev.preventDefault();
		Meteor.subscribe("apps", this._id);
	}
})
