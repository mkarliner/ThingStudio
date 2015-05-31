Template.DataFeedsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
		$('.add-new-item select').material_select();
	}
});

Template.DataFeedsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		menuOps();
	}
});

Template.DataFeedsBody.helpers({
	feedlist: function(){
		return Feeds.find({owner: Meteor.userId()}, {sort: {createdAt: -1}})
	},
	publicfeeds: function() {
		return Feeds.find({public: true})
	},
	ownerName: function(){
		owner = Meteor.users.findOne({_id: this.owner});
		return owner ? owner.username : "Owner Unknown";
	}
});

Meteor.startup(function(){
	Feeds.after.insert(function(userId, doc) {
		mqttClient.subscribe(doc.subscription);
	});
	Feeds.after.update(function(userId, doc) {
		mqttClient.subscribe(doc.subscription);
	});
});